# UK rail data

Groundwork for a train-monitoring feature: API collections and a feed listener for UK train
times, platforms and delays. Nothing here is wired into the app yet.

There are two data sources, and they work differently:

| Source | What it gives you | How you connect | Credentials |
| --- | --- | --- | --- |
| **Live Departure Board** (National Rail Darwin, through Rail Data Marketplace) | A station's next trains: scheduled and expected times, platform, delay and cancellation reasons | REST/JSON, request and response | A free consumer key per product from [raildata.org.uk](https://raildata.org.uk) |
| **Network Rail open data** | Every train movement on the network as it happens (TRUST), signalling berths (TD), timetable files | STOMP stream over TCP, plus HTTP file downloads | Your publicdatafeeds.networkrail.co.uk username and password |

For "when is my train, which platform, is it late", start with the Live Departure Board. The
Network Rail stream is lower level: it reports positions by STANOX code, not station name, and
you have to match it against the timetable yourself.

## Files

- `collection/`: a Bruno collection with requests for both REST sources.
  - `environments/uk-rail.bru`: the variables. Keys and the Network Rail login are listed as
    secrets, so their values are stored by Bruno or NexusMD, never written to this repo.
  - `network-rail/folder.bru` sets the username/password once for every Network Rail request.
- `stomp-listen.mjs`: prints live train movements from the Network Rail STOMP feed.

## Setting up the Live Departure Board

1. Sign up at [raildata.org.uk](https://raildata.org.uk) and subscribe to **Live Departure Board**.
2. Copy the consumer key from the product's Specification tab into `ldbDeparturesKey`.
3. Optional: subscribe to the arrivals-and-departures and service-details products too. Each has
   its own base URL and key: copy them into `ldbArrDepBaseUrl`/`ldbArrDepKey` and
   `ldbServiceBaseUrl`/`ldbServiceKey`.
4. Set `crs` to a station code (`PAD` is London Paddington) and send **Departures**.

## Commute

The `collection/commute/` requests are kept out of the repo (see `.gitignore` here), so your stations
stay on your machine. Set `homeCrs` and `workCrs` to your two stations (3-letter codes, e.g. `EUS`
London Euston, `MAN` Manchester Piccadilly), then send **Commute > To work** or **To home**. Each train in
`trainServices` has:

- `std` / `etd` / `platform`: departure from the first station ("On time", "Delayed" or a new time)
- `subsequentCallingPoints[0].callingPoint`: find your destination there. `st` is the scheduled
  arrival, `et` the expected one, and `at` the actual time once the train has arrived
- `isCancelled`, `cancelReason`, `delayReason` when something has gone wrong

## Using the collection

**Bruno:** open `tools/rail-data/collection` as a collection, select the `uk-rail` environment
and fill in the secret values.

**NexusMD API Client:** use *Import Bruno collection* and pick `tools/rail-data/collection`. The
environment comes across too. Tick *Include scripts and tests* first if you want the collection's test (expects
a 200) and its post-response script, which saves the first train's `serviceId` from any board for
**Service details**. Otherwise set `serviceId` by hand.

## Listening to live train movements

Enable `TRAIN_MVT_ALL_TOC` for your account on the Network Rail feeds site, then run:

```sh
NR_USERNAME=you@example.com NR_PASSWORD=... node tools/rail-data/stomp-listen.mjs
```

On PowerShell, set `$env:NR_USERNAME` and `$env:NR_PASSWORD` first. Each output line shows a
train arriving or departing a location, with its platform and how early or late it is.

- Add a second argument to filter by operator code or STANOX, e.g. `... stomp-listen.mjs TRAIN_MVT_ALL_TOC 25` for GWR.
- Change the first argument to listen to another topic: `TD_ALL_SIG_AREA`, `VSTP_ALL` or `RTPPM_ALL`.
- To turn STANOX codes into station names, download **CORPUS location codes** from the collection.
