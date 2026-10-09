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

**If 8080 is already taken on your machine**, `docker run` stops with an error such as
`port is already allocated` or `address already in use`. Pick another port and try again:

- Change only the first `8080` in `-p 127.0.0.1:8080:8080` — that is the port on your machine. The
  second is the port inside the container and always stays `8080`.
- Any number from 1024 to 65535 works. Numbers below 1024 need administrator rights. Something
  easy to remember, such as `8090` or `18080`, is a good start.
- To see which ports are already in use, run `ss -ltn` on Linux, `lsof -iTCP -sTCP:LISTEN -n -P`
  on macOS, or `netstat -an | findstr LISTENING` on Windows. Or just try the number: if it is
  taken, you get the same error and pick again.

A container that failed to start still holds its name, so remove it with `docker rm thatapp`
before you run the command again. With `-p 127.0.0.1:8090:8080`, for example, you open
<http://localhost:8090> — and use that port everywhere else this README says 8080.

**Keep the `127.0.0.1:` in front of the port.** ThatApp has no login and no defence against
cross-site requests, so anything that can reach the port can use your Jira tokens.
`127.0.0.1:8080:8080` makes it reachable from your own machine only; plain `-p 8080:8080` publishes
it to every network you are on. Binding to your own machine keeps other machines out, but it does
not stop a malicious web page open in your own browser from sending requests to it.

### Or: a hostname instead of a port

If you run [docker-hoster](https://github.com/thisisdevelopment/docker-hoster), you can skip the
published port and open ThatApp by name, at <http://thatapp.docker>. docker-hoster watches your
containers and writes each one's address and hostname into your machine's `/etc/hosts`. **Without
docker-hoster running, this setup gives you an app you cannot reach.**

Add one line to `thatapp.env`, so the app listens on port 80 and the address needs no port:

```shell
THAT_ADDR=:80
```

Then start it:

```shell
docker network create thatapp-net
docker run -d --name thatapp --restart unless-stopped \
  --network thatapp-net \
  --hostname thatapp.docker \
  -v thatapp-data:/data \
  --env-file thatapp.env \
  codeberg.org/diongerrese/thatapp:latest
```

- **The network is required.** docker-hoster ignores containers on Docker's default `bridge`
  network, because that network gives them no DNS names. Any network you create yourself works.
- `--hostname thatapp.docker` is the name docker-hoster writes into `/etc/hosts`. It also adds
  `thatapp.containers.docker`, from the container name.
- Without the `THAT_ADDR` line the app listens on 8080, at <http://thatapp.docker:8080>.

There is no `-p`, so nothing is published on your machine's ports. The container's address is on a
Docker network that only your own machine can reach — Docker 28 and newer block other machines
from it. The same warning as the port still applies: a malicious web page open in your own browser
can send requests to it.

Everywhere else this README says `http://localhost:8080`, use `http://thatapp.docker`. To upgrade or
restore, run this `docker run` again instead of the one above; the network is created only once.

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

### Connecting an assistant

ThatApp serves the [Model Context Protocol](https://modelcontextprotocol.io) at `/mcp`, on the same
port as the app. An assistant connected to it can read your assigned issues, your logged time and
the timer, log and edit time, and start and stop the timer. It cannot push: worklogs reach Jira only
from the app's own Push button, and it will not delete an entry that is already in Jira.

To connect Claude Code, using the port you published in step 2:

```shell
claude mcp add --transport http thatapp http://localhost:8080/mcp
```

**The same warning as the port applies.** `/mcp` has no login either: anything that can reach the
port can read and change your logged time through it. It refuses any request a web page sends, but
that is all it does — keep the `127.0.0.1:` in front of the port.

A tab you left open catches up when you switch back to it, so time logged through the assistant
shows without a reload.
