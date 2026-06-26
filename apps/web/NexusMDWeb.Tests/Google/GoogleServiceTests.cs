using NexusMDWeb.Api.Services;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;
using Xunit;

namespace NexusMDWeb.Tests.Google;

public class GoogleServiceTests
{
    private static GoogleService MakeService(HttpMessageHandler handler)
    {
        var http  = new HttpClient(handler, disposeHandler: false) { BaseAddress = new Uri("https://www.googleapis.com/") };
        var cache = new MemoryCache(Options.Create(new MemoryCacheOptions()));
        return new GoogleService(http, cache);
    }

    [Fact]
    public async Task GetCalendarEventsAsync_sends_bearer_token()
    {
        var handler = new FakeGoogleHandler();
        handler.Responses["/calendar/v3/calendars/primary/events?timeMin=2026-06-01T00%3A00%3A00Z&timeMax=2026-06-08T00%3A00%3A00Z&singleEvents=true&orderBy=startTime"] =
            """{"items":[{"id":"evt1","summary":"Team standup","start":{"dateTime":"2026-06-02T09:00:00Z"},"end":{"dateTime":"2026-06-02T09:30:00Z"},"htmlLink":"https://calendar.google.com/event?eid=evt1"}]}""";

        var svc              = MakeService(handler);
        var (events, error) = await svc.GetCalendarEventsAsync("my-token", DateTime.Parse("2026-06-01"), DateTime.Parse("2026-06-08"), default);

        Assert.Single(events);
        Assert.Equal("Team standup", events[0].Title);
        Assert.Equal("Bearer my-token", handler.Calls[0].AuthHeader);
    }

    [Fact]
    public async Task GetGmailDigestAsync_filters_to_inbox_and_maps_fields()
    {
        var handler = new FakeGoogleHandler();
        handler.Responses["/gmail/v1/users/me/messages?labelIds=INBOX&maxResults=50"] =
            """{"messages":[{"id":"msg1"}]}""";
        handler.Responses["/gmail/v1/users/me/messages/msg1?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date"] =
            """{"id":"msg1","snippet":"Build succeeded","payload":{"headers":[{"name":"Subject","value":"CI passed"},{"name":"From","value":"noreply@github.com"},{"name":"Date","value":"Mon, 02 Jun 2026 09:00:00 +0000"}]}}""";

        var svc  = MakeService(handler);
        var msgs = await svc.GetGmailDigestAsync("my-token", default);

        Assert.Single(msgs);
        Assert.Equal("CI passed", msgs[0].Subject);
        Assert.Equal("noreply@github.com", msgs[0].From);
        Assert.Equal("Build succeeded", msgs[0].Snippet);
    }

    [Fact]
    public async Task ListDriveBackupsAsync_returns_app_json_files()
    {
        var handler = new FakeGoogleHandler();
        handler.Responses["/drive/v3/files?spaces=appDataFolder&fields=files(id%2Cname%2CmodifiedTime%2Csize)&orderBy=modifiedTime%20desc"] =
            """{"files":[{"id":"f1","name":"nexusmd-backup-2026-06-01.json","modifiedTime":"2026-06-01T10:00:00Z","size":"4096"}]}""";

        var svc   = MakeService(handler);
        var files = await svc.ListDriveBackupsAsync("my-token", default);

        Assert.Single(files);
        Assert.Equal("f1", files[0].Id);
        Assert.Equal("nexusmd-backup-2026-06-01.json", files[0].Name);
    }

    [Fact]
    public async Task ListPlannerFilesAsync_returns_files_with_version_from_appProperties()
    {
        var handler = new FakeGoogleHandler();
        var encodedQ      = Uri.EscapeDataString("name contains 'planner-profile1-'");
        var encodedFields = Uri.EscapeDataString("files(id,name,modifiedTime,appProperties)");
        handler.Responses[$"/drive/v3/files?spaces=appDataFolder&q={encodedQ}&fields={encodedFields}&orderBy=modifiedTime%20desc"] =
            """{"files":[{"id":"p1","name":"planner-profile1-2026-W24.json","modifiedTime":"2026-06-15T09:00:00Z","appProperties":{"version":"7"}}]}""";

        var svc   = MakeService(handler);
        var files = await svc.ListPlannerFilesAsync("my-token", "profile1", default);

        Assert.Single(files);
        Assert.Equal("p1",                              files[0].Id);
        Assert.Equal("planner-profile1-2026-W24.json", files[0].Name);
        Assert.Equal(7,                                files[0].Version);
    }

    [Fact]
    public async Task UpsertPlannerFileAsync_creates_new_file_and_returns_file_id()
    {
        var handler = new FakeGoogleHandler();
        handler.Responses["/upload/drive/v3/files?uploadType=multipart"] =
            """{"id":"new-file-id"}""";

        var svc    = MakeService(handler);
        var fileId = await svc.UpsertPlannerFileAsync(
            "my-token", "planner-abc-2026-W24.json",
            """{"version":1,"data":{}}""", 1, null, default);

        Assert.Equal("new-file-id", fileId);
        Assert.Single(handler.Calls);
        Assert.Equal(HttpMethod.Post, handler.Calls[0].Method);
        Assert.Contains("appDataFolder", handler.Calls[0].Body ?? "");
    }

    [Fact]
    public async Task UpsertPlannerFileAsync_patches_existing_file_and_returns_same_id()
    {
        var handler = new FakeGoogleHandler();
        handler.Responses["/upload/drive/v3/files/existing-id?uploadType=multipart"] =
            """{"id":"existing-id"}""";

        var svc    = MakeService(handler);
        var fileId = await svc.UpsertPlannerFileAsync(
            "my-token", "planner-abc-2026-W24.json",
            """{"version":2,"data":{}}""", 2, "existing-id", default);

        Assert.Equal("existing-id", fileId);
        Assert.Single(handler.Calls);
        Assert.Equal(HttpMethod.Patch, handler.Calls[0].Method);
    }

    [Fact]
    public async Task UpsertPlannerFileAsync_returns_null_on_http_error()
    {
        var svc    = MakeService(new ErrorGoogleHandler(System.Net.HttpStatusCode.Unauthorized));
        var fileId = await svc.UpsertPlannerFileAsync("bad-token", "planner-abc-2026-W24.json", "{}", 1, null, default);
        Assert.Null(fileId);
    }
}