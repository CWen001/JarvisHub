import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

// Execute the real launcher functions, replacing only OS/service boundaries.
const source = readFileSync(new URL('../run.sh', import.meta.url), 'utf8');
const functions = source.match(/^[a-z_]+\(\) \{\n[\s\S]*?^\}/gm).join('\n');
function run(script) {
  return spawnSync('/bin/bash', ['-c', `set -euo pipefail\n${functions}\n${script}`], {
    encoding: 'utf8', timeout: 5000,
  });
}

for (const state of ['stopped', 'stalled', 'ready', 'broken']) {
  test(`managed Postgres with Docker ${state}`, () => {
    const result = run(`
      state=${state}
      unset DOCKER_HOST DOCKER_CONTEXT
      uname() { echo Darwin; }
      docker() {
        case "$*" in
          'compose version') return 0 ;;
          'context show') echo desktop-linux ;;
          'info') [ "$state" = ready ] ;;
          'desktop start --timeout 120')
            echo desktop-start
            [ "$state" != stopped ] || state=ready
            [ "$state" = ready ] ;;
          'desktop restart --timeout 120')
            echo desktop-restart
            [ "$state" != stalled ] || state=ready
            [ "$state" = ready ] ;;
          *) return 1 ;;
        esac
      }
      compose_api() {
        if [ "$state" != ready ]; then
          echo 'Cannot connect to the Docker daemon' >&2
          return 1
        fi
        echo postgres-ready
      }
      start_managed_postgres
    `);
    if (state === 'broken') {
      assert.notEqual(result.status, 0);
      assert.doesNotMatch(result.stdout, /postgres-ready/);
    } else {
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout, /postgres-ready/);
      if (state === 'ready') assert.doesNotMatch(result.stdout, /desktop-start/);
      else assert.match(result.stdout, /desktop-start[\s\S]*postgres-ready/);
      if (state === 'stalled') assert.match(result.stdout, /desktop-restart/);
    }
  });
}

test('unhealthy Postgres is recreated once without deleting its volume', () => {
  const result = run(`
    require_docker_compose() { :; }
    ensure_docker_runtime() { :; }
    compose_api() {
      echo "$*"
      [[ "$*" == *--force-recreate* ]]
    }
    start_managed_postgres
  `);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /--force-recreate/);
  assert.doesNotMatch(result.stdout, /^(down|volume|rm)\b|--volumes/m);
});

test('readiness waits for HTTP success, and rejects an exited service', () => {
  const ready = run(`
    pids=("$$"); names=(web)
    WEB_HOST=127.0.0.1; WEB_PORT=5175; API_PORT=8788; AGENTS_PORT=8799
    TRACE_API_PORT=5781; TRACE_WEB_PORT=5782
    curl() { echo "$*"; }
    wait_for_services
  `);
  assert.equal(ready.status, 0, ready.stderr);
  assert.match(ready.stdout, /8788\/health\/version/);
  assert.match(ready.stdout, /8799\/health/);
  assert.match(ready.stdout, /5781\/api\/health/);
  const dead = run(`
    pids=(99999999); names=(web)
    WEB_HOST=127.0.0.1; WEB_PORT=5175; API_PORT=8788; AGENTS_PORT=8799
    TRACE_API_PORT=5781; TRACE_WEB_PORT=5782
    curl() { return 0; }
    wait_for_services
  `);
  assert.notEqual(dead.status, 0);
});

test('HTTP readiness retries transient failures and fails within its deadline', () => {
  for (const recovers of [true, false]) {
    const result = run(`
      pids=("$$"); names=(web)
      WEB_HOST=127.0.0.1; WEB_PORT=5175; API_PORT=8788; AGENTS_PORT=8799
      TRACE_API_PORT=5781; TRACE_WEB_PORT=5782
      attempts=0
      curl() { attempts=$((attempts + 1)); ${recovers ? '[ "$attempts" -gt 1 ]' : 'return 1'}; }
      sleep() { SECONDS=$((SECONDS + 60)); }
      wait_for_services
    `);
    assert.equal(result.status, recovers ? 0 : 1, result.stderr);
    if (!recovers) assert.match(result.stderr, /Timed out/);
  }
});

test('unavailable remote Docker is not restarted or silently replaced', () => {
  const result = run(`
    export DOCKER_HOST=tcp://remote.example:2376
    uname() { echo Darwin; }
    docker() {
      case "$*" in
        'info') return 1 ;;
        'context show') echo default ;;
        *) echo unexpected-desktop-mutation; return 0 ;;
      esac
    }
    ensure_docker_runtime
  `);
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stdout, /unexpected-desktop-mutation/);
});

test('browser opens only after services pass readiness', () => {
  assert.ok(/\nwait_for_services\n[\s\S]*Services ready:[\s\S]*\nopen_browser\n/.test(source));
  const result = run(`
    WEB_PORT=5175
    uname() { echo Darwin; }
    open() { printf 'browser:%s\\n' "$*"; }
    open_browser
  `);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /browser:http:\/\/localhost:5175/);
});
