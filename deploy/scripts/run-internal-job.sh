#!/usr/bin/env sh
# Runs one background job of the application from cron on the VDS host:
#
#   sh /opt/apex/deploy/scripts/run-internal-job.sh notifications
#   sh /opt/apex/deploy/scripts/run-internal-job.sh reservations
#
# and once after every deployment that recreates the app container, to
# rebuild the pages prerendered without a database at build time:
#
#   sh /opt/apex/deploy/scripts/run-internal-job.sh site-revalidation
#
# The request is made inside the app container to http://127.0.0.1:3000,
# bypassing nginx (where /api/internal/ is closed to outside clients).
# X-Job-Key is read from INTERNAL_JOB_SECRET in the container environment, so
# the secret is not in crontab, in the command line or in the host's shell
# history. Prints nothing on success; on failure prints the HTTP status and a
# shortened response body (job counters, no personal data) and exits with 1.
set -eu

# Job name = last segment of /api/internal/jobs/<name>; only [a-z0-9-] allowed.
job="${1:-}"
case "$job" in
  '' | -* | *[!a-z0-9-]*)
    echo "usage: $0 <job>  (notifications, reservations, site-revalidation, catalog-revalidation)" >&2
    exit 2
    ;;
esac

deploy_dir=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
env_file="${APEX_ENV_FILE:-$(dirname -- "$deploy_dir")/.env.production}"

exec docker compose --env-file "$env_file" \
  -f "$deploy_dir/docker-compose.production.yml" \
  exec -T app node -e '
const job = process.argv[1];
fetch(`http://127.0.0.1:3000/api/internal/jobs/${job}`, {
  method: "POST",
  headers: { "X-Job-Key": process.env.INTERNAL_JOB_SECRET ?? "" },
  signal: AbortSignal.timeout(55_000),
})
  .then(async (response) => {
    const body = await response.text();
    let ok = response.ok;
    try {
      if (JSON.parse(body).ok === false) ok = false;
    } catch {}
    if (!ok) {
      console.error(`${job}: HTTP ${response.status} ${body.slice(0, 300)}`);
      process.exitCode = 1;
    }
  })
  .catch((error) => {
    console.error(`${job}: ${error.message}`);
    process.exitCode = 1;
  });
' "$job"
