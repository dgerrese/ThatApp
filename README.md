# ThatApp

A personal dashboard for the Jira issues assigned to you across several Jira Cloud sites, with local
time tracking that is pushed to Jira as worklogs. One user per install.

## Running it

You need Docker. Nothing else.

### 1. Make a secret key — once, and keep it

ThatApp encrypts your Jira API tokens with a key only you hold. **Generate your own; never reuse
someone else's.** Anyone with your key and your data volume can read your tokens.

```shell
docker run --rm alpine sh -c 'head -c 32 /dev/urandom | base64'
```

Put it in a file called `thatapp.env`, next to your timezone:

```shell
THAT_SECRET_KEY=<the key you just generated>
THAT_TIMEZONE=Europe/Amsterdam
```

`THAT_TIMEZONE` is an [IANA name](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones). It
decides where your day ends, for the end-of-day push and the weekly rollup.

**If you lose the key**, the app cannot read the tokens it stored. Your time entries survive, but you
will have to enter each Jira API token again. Keep the file somewhere safe and out of version
control.

### 2. Start it

```shell
docker run -d --name thatapp --restart unless-stopped \
  -p 127.0.0.1:8080:8080 \
  -v thatapp-data:/data \
  --env-file thatapp.env \
  codeberg.org/diongerrese/thatapp:latest
```

Open <http://localhost:8080>.

**Keep the `127.0.0.1:` in front of the port.** ThatApp has no login and no defence against
cross-site requests, so anything that can reach the port can use your Jira tokens.
`127.0.0.1:8080:8080` makes it reachable from your own machine only; plain `-p 8080:8080` publishes
it to every network you are on. Binding to your own machine keeps other machines out, but it does
not stop a malicious web page open in your own browser from sending requests to it.

### 3. Upgrade

Releases are named `YYYY.WW.N` — year, ISO week, and the release number within that week. To move to
the newest:

```shell
docker pull codeberg.org/diongerrese/thatapp:latest
docker stop thatapp && docker rm thatapp
```

then run the command from step 2 again. Your data is in the `thatapp-data` volume and is upgraded
in place when the app starts. To stay on one release, use its tag instead of `latest`, for example
`codeberg.org/diongerrese/thatapp:2026.38.1`.

### Backing up

Everything is in the `thatapp-data` volume. Stop the app first, so the database is not mid-write:

```shell
docker stop thatapp
docker run --rm -v thatapp-data:/data -v "$PWD":/backup alpine tar czf /backup/thatapp-data.tgz -C /data .
docker start thatapp
```

To restore, stop and remove the app, replace the volume with the backup, and start it again with
the command from step 2:

```shell
docker stop thatapp && docker rm thatapp
docker volume rm thatapp-data
docker run --rm -v thatapp-data:/data -v "$PWD":/backup alpine tar xzf /backup/thatapp-data.tgz -C /data
```

Back up `thatapp.env` too — the data is no use without its key.
