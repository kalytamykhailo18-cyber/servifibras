# systemd staging — Servifibras

Unit files staged in the repo for review. They are NOT installed by
`deploy.sh` — install manually with the snippets below when you want
the corresponding cron / oneshot to start running.

## servifibras-ml-quality-sweep (daily ML quality sweep)

Runs `ops/ml-quality-sweep-cron.sh 1 300` once a day at 04:30 UTC
(~01:30 ART). Writes the report to `/var/log/servifibras/ml-quality-sweep-*.log`
and exits non-zero if any `[CRIT]` pattern fires, so `systemctl --failed`
shows the unit and journal logs reveal which pattern hit.

Install (root, one-time):

```bash
install -m 644 /home/servifibras/ops/systemd/servifibras-ml-quality-sweep.service /etc/systemd/system/
install -m 644 /home/servifibras/ops/systemd/servifibras-ml-quality-sweep.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now servifibras-ml-quality-sweep.timer
```

Check it's queued:

```bash
systemctl list-timers servifibras-ml-quality-sweep.timer
```

Run it manually right now (one-shot, doesn't affect the timer):

```bash
systemctl start servifibras-ml-quality-sweep.service
journalctl -u servifibras-ml-quality-sweep.service -n 200 --no-pager
```

Uninstall:

```bash
systemctl disable --now servifibras-ml-quality-sweep.timer
rm /etc/systemd/system/servifibras-ml-quality-sweep.{service,timer}
systemctl daemon-reload
```
