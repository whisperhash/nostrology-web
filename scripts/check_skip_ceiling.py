#!/usr/bin/env python3
"""Fails when a test suite skipped more tests than it is allowed to, or ran too few.

A suite that loses a dependency does not fail, it skips, and vitest exits 0. With the database gone or
TEST_DATABASE_URL misspelt, every database test skips and the run stays green having tested less than it
says, which is nostrology-web#23 (CI skips all 7 database test files: add a Postgres service to the
deploy workflow's test job). So the gate holds the suite to the skips it has today. A skip someone adds
on purpose raises the ceiling in the same change.

A suite can also lose tests without skipping any, as a deleted file or a narrowed `include` does, so FLOOR is the fewest
tests that must run, passing or not. It is loose on purpose, about 90% of today's, so it catches a suite
that lost much of itself and leaves ordinary test deletions alone. It cannot see one lost file, or all of
src/lib/db: the deploy workflow's db-files step counts those.

    check_skip_ceiling.py REPORT:CEILING[:FLOOR] [REPORT:CEILING[:FLOOR] ...]

REPORT is what vitest's junit reporter wrote. A report that is missing, unreadable or empty fails too: a
suite that did not run has not passed. Standard library only, as this runs on the system Python,
outside the test environments.

Copied from nostrology-data's scripts/check_skip_ceiling.py, with this docstring changed and the code
the same. Its tests here are in deploy-gate-scripts.test.mjs.
"""
import sys
import xml.etree.ElementTree as ET


def read_report(path):
    """(tests, skipped) over every testsuite element in a JUnit report."""
    root = ET.parse(path).getroot()
    suites = [root] if root.tag == "testsuite" else root.findall("testsuite")
    if not suites:
        raise ValueError("it has no testsuite element")
    return (sum(int(s.get("tests")) for s in suites), sum(int(s.get("skipped")) for s in suites))


def parse(spec):
    """(path, ceiling, floor or None) from REPORT:CEILING[:FLOOR]. Raises ValueError if it is neither."""
    parts = spec.rsplit(":", 2)
    if len(parts) == 3 and parts[1].isdigit():
        path, ceiling, floor = parts[0], int(parts[1]), int(parts[2])
    else:
        path, ceiling = spec.rsplit(":", 1)
        ceiling, floor = int(ceiling), None
    if not path or ceiling < 0 or (floor is not None and floor < 0):
        raise ValueError
    return path, ceiling, floor


def check(spec):
    """One REPORT:CEILING[:FLOOR]. Prints what it found and returns whether it passed."""
    try:
        path, allowed, floor = parse(spec)
    except ValueError:
        print("::error::%r is not REPORT:CEILING[:FLOOR]" % spec)
        return False
    try:
        tests, skipped = read_report(path)
    except (OSError, ET.ParseError, ValueError, TypeError) as exc:
        print("::error::%s: no usable test report, so that suite counts as not run: %s" % (path, exc))
        return False
    if tests == 0:
        print("::error::%s: ran no tests" % path)
        return False
    if skipped > allowed:
        print("::error::%s: %d of %d tests skipped, above the ceiling of %d. Read the skip reasons "
              "above: a lost dependency is the usual cause, and a deliberate new skip raises the "
              "ceiling in the same change." % (path, skipped, tests, allowed))
        return False
    if floor is not None and tests - skipped < floor:
        print("::error::%s: only %d of %d tests ran, below the floor of %d, so the suite lost tests "
              "without skipping them. Read what it collected: a deliberate large deletion lowers "
              "the floor in the same change." % (path, tests - skipped, tests, floor))
        return False
    note = " (the ceiling can come down to %d)" % skipped if skipped < allowed else ""
    print("%s: %d tests, %d skipped, ceiling %d%s" % (path, tests, skipped, allowed, note))
    return True


def main(argv):
    if len(argv) < 2:
        print("usage: check_skip_ceiling.py REPORT:CEILING[:FLOOR] [REPORT:CEILING[:FLOOR] ...]", file=sys.stderr)
        return 2
    # A list, not a generator: every report is read, so one run names every suite over its ceiling.
    return 0 if all([check(spec) for spec in argv[1:]]) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
