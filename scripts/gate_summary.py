#!/usr/bin/env python3
"""What the test gate found, in the few lines its Discord post carries.

The gate's job holds no secret, so it cannot post. It writes this to its step output, and the job
after it posts: `deploy` when green, `gate-failed` when red.

    gate_summary.py LABEL=REPORT [LABEL=REPORT ...]

REPORT is what vitest's junit reporter wrote. STEPS is the workflow's toJSON(steps), which names the steps
that failed, and GATE_STARTED the job's start in epoch seconds. Standard library only, as this runs
on the system Python, outside the test environments. It does not fail on what it cannot read: it
says so, because the post matters most when something has already gone wrong.

Copied from nostrology-data's scripts/gate_summary.py, with this docstring changed and the code the
same. Its tests here are in deploy-gate-scripts.test.mjs.
"""
import json
import os
import sys
import time
import uuid
import xml.etree.ElementTree as ET

MAX_NAMES = 10      # failed tests named in a post; the run's log has the rest
MAX_NAME_CHARS = 150
MAX_CHARS = 1800    # a Discord description holds 4,096, and the posts add lines of their own


def read_report(path):
    """(tests, failed, skipped, the failed tests' names) over every testsuite in a JUnit report."""
    root = ET.parse(path).getroot()
    suites = [root] if root.tag == "testsuite" else root.findall("testsuite")
    if not suites:
        raise ValueError("no testsuite element")
    tests = sum(int(s.get("tests")) for s in suites)
    failed = sum(int(s.get("failures")) + int(s.get("errors")) for s in suites)
    skipped = sum(int(s.get("skipped")) for s in suites)
    names = ["%s::%s" % (case.get("classname"), case.get("name")) for case in root.iter("testcase")
             if case.find("failure") is not None or case.find("error") is not None]
    return tests, failed, skipped, names


def failed_steps(steps_json):
    """The ids of the steps that failed or were stopped, from toJSON(steps)."""
    try:
        steps = json.loads(steps_json or "{}")
        return [k for k, v in steps.items() if v.get("outcome") in ("failure", "cancelled")]
    except (ValueError, AttributeError):
        return []


def summarize(specs, steps_json, started, now):
    lines, names = [], []
    for spec in specs:
        label, _, path = spec.partition("=")
        try:
            tests, failed, skipped, found = read_report(path)
        except (OSError, ET.ParseError, ValueError, TypeError) as exc:
            lines.append("%s: no usable report (%s)" % (label, type(exc).__name__))
            continue
        part = "%s: %s passed, %s skipped" % (label, format(tests - failed - skipped, ","), format(skipped, ","))
        if failed:
            part += ", %s failed" % format(failed, ",")
        lines.append(part)
        names += found
    bad_steps = failed_steps(steps_json)
    if bad_steps:
        lines.append("Failed steps: " + ", ".join(bad_steps))
    if names:
        lines.append("Failed tests:")
        for name in names[:MAX_NAMES]:
            lines.append(name if len(name) <= MAX_NAME_CHARS else name[:MAX_NAME_CHARS - 3] + "...")
        if len(names) > MAX_NAMES:
            lines.append("and %d more in the run's log" % (len(names) - MAX_NAMES))
    if started:
        lines.append("Took %.1f min." % ((now - started) / 60.0))
    text = "\n".join(lines)
    return text if len(text) <= MAX_CHARS else text[:MAX_CHARS - 3] + "..."


def main(argv):
    if len(argv) < 2:
        print("usage: gate_summary.py LABEL=REPORT [LABEL=REPORT ...]", file=sys.stderr)
        return 2
    try:
        started = int(os.environ.get("GATE_STARTED") or 0)
    except ValueError:
        started = 0
    text = summarize(argv[1:], os.environ.get("STEPS"), started, time.time())
    print(text)
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        # A delimiter nothing in the text can contain: a test's name is not ours to trust.
        delimiter = "gate_summary_" + uuid.uuid4().hex
        with open(out, "a") as f:
            f.write("text<<%s\n%s\n%s\n" % (delimiter, text, delimiter))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
