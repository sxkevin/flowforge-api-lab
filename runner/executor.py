import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import datetime, timezone


FULL_TEMPLATE_RE = re.compile(r"^{{\s*([^}]+?)\s*}}$")
TEMPLATE_RE = re.compile(r"{{\s*([^}]+?)\s*}}")
MAX_PARALLEL_BRANCHES = 4


def now_iso():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def create_id(prefix="id"):
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


class ObjectView:
    def __init__(self, source):
        object.__setattr__(self, "_source", source)

    def __getattr__(self, item):
        source = object.__getattribute__(self, "_source")
        if item in source:
            return wrap(source[item])
        raise AttributeError(item)

    def __setattr__(self, key, value):
        source = object.__getattribute__(self, "_source")
        source[key] = unwrap(value)

    def __getitem__(self, item):
        source = object.__getattribute__(self, "_source")
        return wrap(source[item])

    def __contains__(self, item):
        source = object.__getattribute__(self, "_source")
        return item in source

    def get(self, key, default=None):
        source = object.__getattribute__(self, "_source")
        return wrap(source.get(key, default))

    def to_plain(self):
        return object.__getattribute__(self, "_source")


def wrap(value):
    if isinstance(value, dict):
        return ObjectView(value)
    if isinstance(value, list):
        return [wrap(item) for item in value]
    return value


def unwrap(value):
    if isinstance(value, ObjectView):
        return value.to_plain()
    if isinstance(value, list):
        return [unwrap(item) for item in value]
    if isinstance(value, dict):
        return {key: unwrap(item) for key, item in value.items()}
    return value


def preprocess_script(script):
    normalized = script
    normalized = normalized.replace("&&", " and ")
    normalized = normalized.replace("||", " or ")
    normalized = normalized.replace("===", "==")
    normalized = normalized.replace("!==", "!=")
    normalized = re.sub(r"\btrue\b", "True", normalized, flags=re.IGNORECASE)
    normalized = re.sub(r"\bfalse\b", "False", normalized, flags=re.IGNORECASE)
    normalized = re.sub(r"\bnull\b", "None", normalized, flags=re.IGNORECASE)
    normalized = re.sub(r"\bassert\s*\(", "check(", normalized)
    return normalized


def tokenize_path(path):
    if not path:
        return []

    normalized = str(path).strip()
    normalized = re.sub(r"^\$\.", "", normalized)
    normalized = re.sub(r"^\$", "", normalized)
    if not normalized:
        return []

    tokens = []
    for segment in normalized.split("."):
        if not segment:
            continue
        for match in re.finditer(r"([^[\]]+)|\[(\d+|\".+?\"|'.+?')\]", segment):
            token = match.group(1) or match.group(2)
            if token.isdigit():
                tokens.append(int(token))
            else:
                tokens.append(token.strip("'\""))
    return tokens


def resolve_path(target, path):
    current = target
    for token in tokenize_path(path):
        if isinstance(current, ObjectView):
            current = current.to_plain()
        if current is None:
            return None
        if isinstance(token, int):
            if not isinstance(current, list) or token >= len(current):
                return None
            current = current[token]
        else:
            if not isinstance(current, dict) or token not in current:
                return None
            current = current[token]
    return current


def resolve_xpath(xml_text, path):
    if not xml_text or not path:
        return None

    normalized = str(path).strip()
    wants_text = normalized.endswith("/text()")
    normalized = re.sub(r"/text\(\)$", "", normalized)
    normalized = re.sub(r"^/+", "", normalized)
    if not normalized:
        return None

    current = str(xml_text)
    parts = [part for part in normalized.split("/") if part]
    for raw_part in parts:
        match = re.match(r"^([A-Za-z0-9:_-]+)(?:\[(\d+)\])?$", raw_part)
        if not match:
            return None
        tag = match.group(1)
        index = int(match.group(2) or "1") - 1
        matches = list(re.finditer(rf"<{tag}(?:\s[^>]*)?>([\s\S]*?)</{tag}>", current))
        if index >= len(matches):
            return None
        current = matches[index].group(1)

    if wants_text:
        return re.sub(r"<[^>]+>", "", current).strip()
    return current.strip()


def builtins():
    return {
        "now": now_iso(),
        "timestamp": int(time.time() * 1000),
        "random": uuid.uuid4().hex[:8],
        "uuid": create_id("var")
    }


def resolve_expression(expression, context):
    name = expression.strip()
    dynamic = builtins()
    if name in dynamic:
        return dynamic[name]
    merged = {
        **context,
        "builtin": dynamic
    }
    return resolve_path(merged, name)


def render_template(value, context):
    if value is None:
        return value
    if isinstance(value, str):
        full = FULL_TEMPLATE_RE.match(value)
        if full:
            resolved = resolve_expression(full.group(1), context)
            return value if resolved is None else resolved

        def replacer(match):
            resolved = resolve_expression(match.group(1), context)
            return "" if resolved is None else str(resolved)

        return TEMPLATE_RE.sub(replacer, value)

    if isinstance(value, list):
        return [render_template(item, context) for item in value]

    if isinstance(value, dict):
        return {key: render_template(item, context) for key, item in value.items()}

    return value


def to_object(entries):
    if not entries:
        return {}
    if isinstance(entries, dict):
        return entries
    output = {}
    for entry in entries:
        key = entry.get("key") if isinstance(entry, dict) else None
        if key:
            output[str(key)] = entry.get("value", "")
    return output


def normalize_headers(headers):
    return {str(key).lower(): value for key, value in (headers or {}).items()}


def compare_values(actual, expected, operator="equals"):
    if operator == "equals":
        return actual == expected
    if operator == "notEquals":
        return actual != expected
    if operator == "contains":
        return str(expected) in str(actual)
    if operator == "gt":
        return float(actual) > float(expected)
    if operator == "gte":
        return float(actual) >= float(expected)
    if operator == "lt":
        return float(actual) < float(expected)
    if operator == "lte":
        return float(actual) <= float(expected)
    if operator == "exists":
        return actual is not None
    return False


def type_of_value(value):
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, list):
        return "array"
    if value is None:
        return "null"
    if isinstance(value, dict):
        return "object"
    if isinstance(value, str):
        return "string"
    if isinstance(value, (int, float)):
        return "number"
    return type(value).__name__


def validate_schema(schema, data, path="$"):
    errors = []
    if not isinstance(schema, dict):
        return errors

    expected_type = schema.get("type")
    if expected_type and type_of_value(data) != expected_type:
        errors.append(f"{path} expected type {expected_type} but got {type_of_value(data)}")
        return errors

    required = schema.get("required") or []
    if isinstance(data, dict):
        for key in required:
            if key not in data:
                errors.append(f"{path}.{key} is required")

    properties = schema.get("properties") or {}
    if isinstance(data, dict):
        for key, child in properties.items():
            if key in data:
                errors.extend(validate_schema(child, data[key], f"{path}.{key}"))

    items = schema.get("items")
    if items and isinstance(data, list):
        for index, item in enumerate(data):
            errors.extend(validate_schema(items, item, f"{path}[{index}]"))

    return errors


def run_assertions(assertions, response_context):
    results = []
    body = response_context.get("body")
    body_text = response_context.get("bodyText", "")
    headers = response_context.get("headers", {})

    for assertion in assertions or []:
        assertion_type = assertion.get("type")
        expected = assertion.get("expected")
        actual = None
        passed = False
        message = ""

        if assertion_type == "status":
            actual = response_context.get("status")
            passed = compare_values(actual, int(expected), assertion.get("operator", "equals"))
        elif assertion_type in ("fieldEquals", "jsonPath"):
            actual = resolve_path(body, assertion.get("path"))
            passed = compare_values(actual, expected, assertion.get("operator", "equals"))
        elif assertion_type == "fieldType":
            actual = type_of_value(resolve_path(body, assertion.get("path")))
            passed = compare_values(actual, expected, "equals")
        elif assertion_type == "exists":
            actual = resolve_path(body, assertion.get("path"))
            passed = compare_values(actual, expected, "exists")
        elif assertion_type == "responseTime":
            actual = response_context.get("duration")
            passed = compare_values(actual, float(expected), assertion.get("operator", "lte"))
        elif assertion_type == "headerEquals":
            actual = headers.get(str(assertion.get("name", "")).lower())
            passed = compare_values(actual, expected, assertion.get("operator", "equals"))
        elif assertion_type == "bodyContains":
            actual = body_text
            passed = compare_values(actual, expected, "contains")
        elif assertion_type == "jsonSchema":
            actual = body
            expected = assertion.get("schema")
            errors = validate_schema(assertion.get("schema"), body)
            passed = len(errors) == 0
            message = "; ".join(errors)
        elif assertion_type == "xpath":
            actual = resolve_xpath(body_text, assertion.get("path"))
            passed = compare_values(actual, expected, assertion.get("operator", "equals"))

        if not message:
            message = (
                f"{assertion_type} passed"
                if passed
                else f"{assertion_type} failed: expected {json.dumps(expected, ensure_ascii=False)}, got {json.dumps(actual, ensure_ascii=False)}"
            )

        results.append({
            "type": assertion_type,
            "passed": passed,
            "actual": actual,
            "expected": expected,
            "message": message
        })

    return results


def find_by_id(collection, entity_id):
    for item in collection:
        if item.get("id") == entity_id:
            return deepcopy(item)
    return None


def run_script(script, context):
    if not script or not str(script).strip():
        return {"passed": True, "errors": []}

    errors = []
    source = preprocess_script(str(script))
    vars_store = context["vars"]

    def check(condition, message="custom assertion failed"):
        if not condition:
            raise AssertionError(message)

    def set_value(name, value):
        vars_store[name] = unwrap(value)

    def get_value(name):
        return wrap(vars_store.get(name))

    namespace = {
        "vars": wrap(vars_store),
        "request": wrap(context.get("request") or {}),
        "response": wrap(context.get("response") or {}),
        "set": set_value,
        "get": get_value,
        "check": check,
        "len": len,
        "str": str,
        "int": int,
        "float": float,
        "bool": bool
    }

    try:
        exec(source, {"__builtins__": {}}, namespace)
        return {"passed": True, "errors": []}
    except Exception as error:
        errors.append(str(error))
        return {"passed": False, "errors": errors}


def evaluate_condition(condition, context):
    if not condition:
        return True
    source = preprocess_script(str(condition))
    namespace = {
        "vars": wrap(context["vars"]),
        "env": wrap(context["env"].get("variables", {})),
        "suite": wrap(context["suite"].get("variables", {})),
        "dataset": wrap(context.get("dataset") or {}),
        "len": len
    }
    try:
        return bool(eval(source, {"__builtins__": {}}, namespace))
    except Exception:
        return False


def build_query_string(query_entries, context):
    params = []
    for entry in query_entries or []:
        key = entry.get("key")
        if not key:
            continue
        value = render_template(entry.get("value"), context)
        if value not in (None, ""):
            params.append((str(key), str(value)))
    return f"?{urllib.parse.urlencode(params)}" if params else ""


def merge_headers(environment, api, case_overrides, context):
    environment_headers = render_template(environment.get("headers", {}), context)
    api_headers = render_template(to_object(api.get("headers")), context)
    override_headers = render_template(case_overrides.get("headers", {}), context)
    merged = {
        **environment_headers,
        **api_headers,
        **override_headers
    }

    auth = environment.get("auth", {})
    if auth.get("type") == "bearer" and auth.get("value"):
        merged.setdefault("authorization", f"Bearer {render_template(auth.get('value'), context)}")
    if auth.get("type") == "apikey" and auth.get("header") and auth.get("value"):
        merged.setdefault(auth["header"], render_template(auth["value"], context))
    return merged


def resolve_timeout_ms(suite, item, case_entity):
    if item.get("timeoutMs") not in (None, ""):
        return int(item.get("timeoutMs"))
    if case_entity.get("timeoutMs") not in (None, ""):
        return int(case_entity.get("timeoutMs"))
    suite_timeout_seconds = suite.get("timeoutSeconds")
    if suite_timeout_seconds not in (None, ""):
        return int(suite_timeout_seconds) * 1000
    return 300000


def normalize_body(api, case_entity, context):
    body = case_entity.get("overrides", {}).get("body", api.get("bodyTemplate"))
    if api.get("bodyMode") == "none" or body in ("", None):
        return None, None
    rendered = render_template(body, context)
    if api.get("bodyMode") == "json":
        return json.dumps(rendered).encode("utf-8"), rendered
    return str(rendered).encode("utf-8"), rendered


def render_assertions(assertions, context):
    rendered = []
    for assertion in assertions or []:
        current = deepcopy(assertion)
        if "expected" in current:
            current["expected"] = render_template(current.get("expected"), context)
        if "schema" in current:
            current["schema"] = render_template(current.get("schema"), context)
        rendered.append(current)
    return rendered


def extract_variables(extracts, response):
    variables = {}
    for rule in extracts or []:
        name = rule.get("name")
        if not name:
            continue
        source = rule.get("source")
        if source == "jsonPath":
            variables[name] = resolve_path(response.get("body"), rule.get("path"))
        elif source == "xpath":
            variables[name] = resolve_xpath(response.get("bodyText"), rule.get("path"))
        elif source == "header":
            header_name = str(rule.get("header") or name).lower()
            variables[name] = response.get("headers", {}).get(header_name)
        elif source == "status":
            variables[name] = response.get("status")
    return variables


def attach_dataset_metadata(step, dataset_context):
    if not dataset_context:
        return step

    return {
        **step,
        "datasetId": dataset_context.get("datasetId"),
        "datasetName": dataset_context.get("datasetName"),
        "datasetRowId": dataset_context.get("rowId"),
        "datasetRowName": dataset_context.get("rowName")
    }


def execute_case(snapshot, suite, item, case_entity, api, environment, shared_vars, trigger, dataset_context=None):
    context = {
        "vars": shared_vars,
        "env": environment,
        "suite": suite,
        "trigger": trigger,
        "dataset": dataset_context or {}
    }

    if not evaluate_condition(item.get("condition"), context):
        now = now_iso()
        return attach_dataset_metadata({
            "id": create_id("step"),
            "caseId": case_entity["id"],
            "caseName": case_entity["name"],
            "apiName": api["name"],
            "status": "skipped",
            "message": "condition evaluated to false",
            "assertions": [],
            "request": None,
            "response": None,
            "startedAt": now,
            "finishedAt": now,
            "duration": 0,
            "extractedVariables": {}
        }, dataset_context)

    for step in api.get("preSteps", []):
        if step.get("type") == "setVar" and step.get("name"):
            shared_vars[step["name"]] = render_template(step.get("value"), context)
        if step.get("type") == "script":
            run_script(step.get("script", ""), {"vars": shared_vars, "request": None, "response": None})

    request_context = {
        "vars": shared_vars,
        "env": environment,
        "suite": suite,
        "item": item,
        "dataset": dataset_context or {}
    }

    method = str(api.get("method", "GET")).upper()
    path = render_template(api.get("path", ""), request_context)
    query_string = build_query_string(case_entity.get("overrides", {}).get("query", api.get("query")), request_context)
    url = f"{environment['baseUrl']}{path}{query_string}"
    headers = merge_headers(environment, api, case_entity.get("overrides", {}), request_context)
    request_body_bytes, request_body_plain = normalize_body(api, case_entity, request_context)
    request_payload = {
        "method": method,
        "url": url,
        "headers": headers
    }
    if request_body_plain is not None:
        request_payload["body"] = request_body_plain

    pre_script = run_script(case_entity.get("preScript", ""), {
        "vars": shared_vars,
        "request": request_payload,
        "response": None
    })
    if not pre_script["passed"]:
        now = now_iso()
        return attach_dataset_metadata({
            "id": create_id("step"),
            "caseId": case_entity["id"],
            "caseName": case_entity["name"],
            "apiName": api["name"],
            "status": "failed",
            "message": f"preScript failed: {'; '.join(pre_script['errors'])}",
            "assertions": [],
            "request": request_payload,
            "response": None,
            "startedAt": now,
            "finishedAt": now,
            "duration": 0,
            "extractedVariables": {}
        }, dataset_context)

    timeout_ms = resolve_timeout_ms(suite, item, case_entity)
    request_obj = urllib.request.Request(url, data=request_body_bytes, method=method)
    for key, value in headers.items():
        request_obj.add_header(str(key), str(value))

    started_at = now_iso()
    started = time.perf_counter()

    try:
        response_obj = urllib.request.urlopen(request_obj, timeout=timeout_ms / 1000)
    except urllib.error.HTTPError as error:
        response_obj = error
    except Exception as error:
        duration = int((time.perf_counter() - started) * 1000)
        return attach_dataset_metadata({
            "id": create_id("step"),
            "caseId": case_entity["id"],
            "caseName": case_entity["name"],
            "apiName": api["name"],
            "status": "failed",
            "message": str(error),
            "assertions": [],
            "request": request_payload,
            "response": None,
            "startedAt": started_at,
            "finishedAt": now_iso(),
            "duration": duration,
            "extractedVariables": {}
        }, dataset_context)

    duration = int((time.perf_counter() - started) * 1000)
    body_text = response_obj.read().decode("utf-8")
    content_type = response_obj.headers.get("Content-Type", "")
    if "application/json" in content_type:
        try:
            body = json.loads(body_text) if body_text else {}
        except json.JSONDecodeError:
            body = {}
    else:
        body = body_text

    response_payload = {
        "status": getattr(response_obj, "status", response_obj.getcode()),
        "headers": normalize_headers(dict(response_obj.headers.items())),
        "body": body,
        "bodyText": body_text,
        "duration": duration
    }

    assertion_results = run_assertions(
        render_assertions(case_entity.get("assertions", []), request_context),
        response_payload
    )
    extracted = extract_variables(case_entity.get("extracts", []), response_payload)
    shared_vars.update(extracted)

    post_script = run_script(case_entity.get("postScript", ""), {
        "vars": shared_vars,
        "request": request_payload,
        "response": response_payload
    })
    if not post_script["passed"]:
        assertion_results.append({
            "type": "customScript",
            "passed": False,
            "actual": None,
            "expected": None,
            "message": "; ".join(post_script["errors"])
        })

    for assertion in item.get("assertions", []):
        if assertion.get("type") == "custom":
            result = run_script(assertion.get("script", ""), {
                "vars": shared_vars,
                "request": request_payload,
                "response": response_payload
            })
            assertion_results.append({
                "type": "scenarioCustom",
                "passed": result["passed"],
                "actual": None,
                "expected": None,
                "message": "scenario custom assertion passed" if result["passed"] else "; ".join(result["errors"])
            })

    status = "passed" if all(item["passed"] for item in assertion_results) else "failed"

    return attach_dataset_metadata({
        "id": create_id("step"),
        "caseId": case_entity["id"],
        "caseName": case_entity["name"],
        "apiName": api["name"],
        "status": status,
        "message": "ok" if status == "passed" else "assertions failed",
        "assertions": assertion_results,
        "request": request_payload,
        "response": response_payload,
        "startedAt": started_at,
        "finishedAt": now_iso(),
        "duration": duration,
        "extractedVariables": extracted
    }, dataset_context)


def summarize_step_results(steps):
    summary = {"total": 0, "passed": 0, "failed": 0, "skipped": 0}
    for step in steps:
        status = step.get("status", "failed")
        summary["total"] += 1
        summary[status] = summary.get(status, 0) + 1
    return summary


def create_suite_ref_failure_step(item, message, dataset_context=None):
    return attach_dataset_metadata({
        "id": create_id("step"),
        "caseId": item.get("suiteId") or "suite",
        "caseName": item.get("suiteName") or "子场景",
        "apiName": "suite",
        "status": "failed",
        "message": message,
        "assertions": [],
        "request": None,
        "response": None,
        "startedAt": now_iso(),
        "finishedAt": now_iso(),
        "duration": 0,
        "extractedVariables": {},
        "itemType": "suite",
        "role": item.get("role") or "test",
        "parallelGroup": item.get("parallelGroup") or ""
    }, dataset_context)


def execute_suite_reference(snapshot, parent_suite, item, environment, trigger, shared_vars, dataset_context=None, stack=None):
    stack = stack or []
    referenced_suite = find_by_id(snapshot.get("suites", []), item.get("suiteId"))
    if referenced_suite is None:
        step = create_suite_ref_failure_step(item, "referenced suite not found", dataset_context)
        return {"steps": [step], "summary": summarize_step_results([step]), "sharedVars": shared_vars}

    if referenced_suite.get("id") in stack:
        step = create_suite_ref_failure_step(item, f"suite cycle detected: {' -> '.join(stack + [referenced_suite.get('id')])}", dataset_context)
        return {"steps": [step], "summary": summarize_step_results([step]), "sharedVars": shared_vars}

    child_shared_vars = deepcopy(shared_vars)
    child_shared_vars.update(deepcopy(referenced_suite.get("variables", {})))
    iteration = execute_suite_iteration(
        snapshot,
        referenced_suite,
        environment,
        trigger,
        child_shared_vars,
        dataset_context,
        stack + [referenced_suite.get("id")]
    )
    annotated_steps = []
    for step in iteration["steps"]:
        annotated_steps.append({
            **step,
            "itemType": "suite" if step.get("caseId") == "scenario" else step.get("itemType", "case"),
            "suiteRefId": referenced_suite.get("id"),
            "suiteRefName": referenced_suite.get("name"),
            "role": item.get("role") or "test",
            "parallelGroup": item.get("parallelGroup") or ""
        })
    return {
        "steps": annotated_steps,
        "summary": iteration["summary"],
        "sharedVars": iteration["sharedVars"]
    }


def execute_item(snapshot, suite, item, environment, trigger, shared_vars, dataset_context=None, stack=None):
    item_type = item.get("itemType", "case")
    context = {
        "vars": shared_vars,
        "env": environment,
        "suite": suite,
        "trigger": trigger,
        "dataset": dataset_context or {}
    }
    if item.get("enabled") is False:
        step_name = "已禁用子场景" if item_type == "suite" else "已禁用步骤"
        step = attach_dataset_metadata({
            "id": create_id("step"),
            "caseId": item.get("suiteId") if item_type == "suite" else item.get("caseId"),
            "caseName": item.get("suiteName") if item_type == "suite" else step_name,
            "apiName": "disabled",
            "status": "skipped",
            "message": "step disabled",
            "assertions": [],
            "request": None,
            "response": None,
            "startedAt": now_iso(),
            "finishedAt": now_iso(),
            "duration": 0,
            "extractedVariables": {},
            "itemType": item_type,
            "role": item.get("role") or "test",
            "parallelGroup": item.get("parallelGroup") or ""
        }, dataset_context)
        return {"steps": [step], "summary": summarize_step_results([step]), "sharedVars": shared_vars}

    if not evaluate_condition(item.get("condition"), context):
        step = attach_dataset_metadata({
            "id": create_id("step"),
            "caseId": item.get("suiteId") if item_type == "suite" else item.get("caseId"),
            "caseName": item.get("suiteName") or ("子场景" if item_type == "suite" else "条件步骤"),
            "apiName": "condition",
            "status": "skipped",
            "message": "condition evaluated to false",
            "assertions": [],
            "request": None,
            "response": None,
            "startedAt": now_iso(),
            "finishedAt": now_iso(),
            "duration": 0,
            "extractedVariables": {},
            "itemType": item_type,
            "role": item.get("role") or "test",
            "parallelGroup": item.get("parallelGroup") or ""
        }, dataset_context)
        return {"steps": [step], "summary": summarize_step_results([step]), "sharedVars": shared_vars}

    if item_type == "suite":
        return execute_suite_reference(snapshot, suite, item, environment, trigger, shared_vars, dataset_context, stack)

    case_entity = find_by_id(snapshot.get("cases", []), item.get("caseId"))

    if case_entity is None:
        step = attach_dataset_metadata({
            "id": create_id("step"),
            "caseId": item.get("caseId"),
            "caseName": "Unknown case",
            "apiName": "Unknown API",
            "status": "failed",
            "message": "case not found",
            "assertions": [],
            "request": None,
            "response": None,
            "startedAt": now_iso(),
            "finishedAt": now_iso(),
            "duration": 0,
            "extractedVariables": {},
            "itemType": "case",
            "role": item.get("role") or "test",
            "parallelGroup": item.get("parallelGroup") or ""
        }, dataset_context)
        return {"steps": [step], "summary": summarize_step_results([step]), "sharedVars": shared_vars}

    api = find_by_id(snapshot.get("apis", []), case_entity.get("apiId"))
    if api is None:
        step = attach_dataset_metadata({
            "id": create_id("step"),
            "caseId": case_entity["id"],
            "caseName": case_entity["name"],
            "apiName": "Unknown API",
            "status": "failed",
            "message": "api definition not found",
            "assertions": [],
            "request": None,
            "response": None,
            "startedAt": now_iso(),
            "finishedAt": now_iso(),
            "duration": 0,
            "extractedVariables": {},
            "itemType": "case",
            "role": item.get("role") or "test",
            "parallelGroup": item.get("parallelGroup") or ""
        }, dataset_context)
        return {"steps": [step], "summary": summarize_step_results([step]), "sharedVars": shared_vars}

    result = execute_case(snapshot, suite, item, case_entity, api, environment, shared_vars, trigger, dataset_context)
    return {
        "steps": [{
            **result,
            "itemType": "case",
            "role": item.get("role") or "test",
            "parallelGroup": item.get("parallelGroup") or ""
        }],
        "summary": summarize_step_results([result]),
        "sharedVars": shared_vars
    }


def execute_parallel_group(snapshot, suite, items, environment, trigger, shared_vars, dataset_context=None, stack=None):
    base_vars = deepcopy(shared_vars)
    ordered_results = []

    with ThreadPoolExecutor(max_workers=min(MAX_PARALLEL_BRANCHES, max(1, len(items)))) as executor:
        futures = [
            executor.submit(
                execute_item,
                snapshot,
                suite,
                item,
                environment,
                trigger,
                deepcopy(base_vars),
                dataset_context,
                stack
            )
            for item in items
        ]
        for index, future in enumerate(futures):
            ordered_results.append((items[index], future.result()))

    steps = []
    summary = {"total": 0, "passed": 0, "failed": 0, "skipped": 0}
    for _, result in ordered_results:
        steps.extend(result["steps"])
        summary["total"] += result["summary"]["total"]
        summary["passed"] += result["summary"]["passed"]
        summary["failed"] += result["summary"]["failed"]
        summary["skipped"] += result["summary"]["skipped"]
        shared_vars.update(result["sharedVars"])

    return {"steps": steps, "summary": summary, "sharedVars": shared_vars}


def execute_suite_iteration(snapshot, suite, environment, trigger, shared_vars, dataset_context=None, stack=None):
    steps = []
    summary = {"total": 0, "passed": 0, "failed": 0, "skipped": 0}
    items = sorted(suite.get("items", []), key=lambda item: item.get("order", 0))
    stack = stack or [suite.get("id")]
    index = 0
    while index < len(items):
        item = items[index]
        parallel_group = item.get("parallelGroup") or ""

        if parallel_group:
            grouped_items = [item]
            index += 1
            while index < len(items) and (items[index].get("parallelGroup") or "") == parallel_group:
                grouped_items.append(items[index])
                index += 1
            result = execute_parallel_group(snapshot, suite, grouped_items, environment, trigger, shared_vars, dataset_context, stack)
            steps.extend(result["steps"])
            summary["total"] += result["summary"]["total"]
            summary["passed"] += result["summary"]["passed"]
            summary["failed"] += result["summary"]["failed"]
            summary["skipped"] += result["summary"]["skipped"]
            shared_vars = result["sharedVars"]
            should_stop = result["summary"]["failed"] > 0 and not suite.get("continueOnFailure") and not any(item.get("continueOnFailure") for item in grouped_items)
            if should_stop:
                break
            continue

        result = execute_item(snapshot, suite, item, environment, trigger, shared_vars, dataset_context, stack)
        steps.extend(result["steps"])
        summary["total"] += result["summary"]["total"]
        summary["passed"] += result["summary"]["passed"]
        summary["failed"] += result["summary"]["failed"]
        summary["skipped"] += result["summary"]["skipped"]
        shared_vars = result["sharedVars"]

        if result["summary"]["failed"] > 0 and not suite.get("continueOnFailure") and not item.get("continueOnFailure"):
            break
        index += 1

    for assertion in suite.get("scenarioAssertions", []):
        if assertion.get("type") == "custom":
            result = run_script(assertion.get("script", ""), {
                "vars": shared_vars,
                "request": None,
                "response": None
            })
            steps.append(attach_dataset_metadata({
                "id": create_id("step"),
                "caseId": "scenario",
                "caseName": "场景级断言",
                "apiName": "suite",
                "status": "passed" if result["passed"] else "failed",
                "message": "scenario assertion passed" if result["passed"] else "; ".join(result["errors"]),
                "assertions": [{
                    "type": "suiteCustom",
                    "passed": result["passed"],
                    "actual": None,
                    "expected": None,
                    "message": "suite assertion passed" if result["passed"] else "; ".join(result["errors"])
                }],
                "request": None,
                "response": None,
                "startedAt": now_iso(),
                "finishedAt": now_iso(),
                "duration": 0,
                "extractedVariables": {}
            }, dataset_context))
            summary["total"] += 1
            summary["passed" if result["passed"] else "failed"] += 1

    return {
        "steps": steps,
        "summary": summary,
        "sharedVars": shared_vars
    }


def execute_suite(snapshot, suite_id, environment_id, trigger="manual"):
    suite = find_by_id(snapshot.get("suites", []), suite_id)
    environment = find_by_id(snapshot.get("environments", []), environment_id)
    if suite is None:
        raise ValueError(f"suite {suite_id} not found")
    if environment is None:
        raise ValueError(f"environment {environment_id} not found")

    run = {
        "id": create_id("run"),
        "suiteId": suite_id,
        "suiteName": suite["name"],
        "environmentId": environment_id,
        "environmentName": environment["name"],
        "trigger": trigger,
        "status": "running",
        "startedAt": now_iso(),
        "finishedAt": None,
        "duration": 0,
        "summary": {"total": 0, "passed": 0, "failed": 0, "skipped": 0},
        "shareToken": create_id("share"),
        "variablesSnapshot": {},
        "datasetResults": [],
        "steps": []
    }

    dataset = find_by_id(snapshot.get("datasets", []), suite.get("datasetId")) if suite.get("datasetId") else None
    dataset_rows = dataset.get("rows", []) if dataset else []
    if not dataset_rows:
        dataset_rows = [None]

    execution_config = suite.get("executionConfig") or {}
    last_shared_vars = {}
    for index, row in enumerate(dataset_rows):
        row_variables = deepcopy(row.get("variables", {})) if row else {}
        dataset_context = None
        if row:
            dataset_context = {
                "datasetId": dataset.get("id"),
                "datasetName": dataset.get("name"),
                "rowId": row.get("id") or f"row_{index + 1}",
                "rowName": row.get("name") or f"数据行 {index + 1}",
                "variables": row_variables
            }

        shared_vars = {
            **deepcopy(environment.get("variables", {})),
            **deepcopy(suite.get("variables", {})),
            **row_variables
        }
        iteration = execute_suite_iteration(snapshot, suite, environment, trigger, shared_vars, dataset_context)
        run["steps"].extend(iteration["steps"])
        run["summary"]["total"] += iteration["summary"]["total"]
        run["summary"]["passed"] += iteration["summary"]["passed"]
        run["summary"]["failed"] += iteration["summary"]["failed"]
        run["summary"]["skipped"] += iteration["summary"]["skipped"]
        last_shared_vars = iteration["sharedVars"]

        if dataset_context:
            run["datasetResults"].append({
                "datasetId": dataset_context["datasetId"],
                "datasetName": dataset_context["datasetName"],
                "rowId": dataset_context["rowId"],
                "rowName": dataset_context["rowName"],
                "summary": iteration["summary"],
                "variablesSnapshot": deepcopy(iteration["sharedVars"])
            })

        if iteration["summary"]["failed"] > 0 and dataset_context and execution_config.get("stopOnDatasetFailure", True):
            break

    run["variablesSnapshot"] = last_shared_vars
    run["finishedAt"] = now_iso()
    run["duration"] = sum(step.get("duration", 0) for step in run["steps"])
    run["status"] = "failed" if run["summary"]["failed"] > 0 else "passed"
    return run
