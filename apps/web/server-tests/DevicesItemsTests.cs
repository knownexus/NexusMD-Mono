using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using NexusMDWeb.Tests.Infrastructure;
using Xunit;

namespace NexusMDWeb.Tests;

/// <summary>HTTP-level tests for /api/devices (+ prefs) and /api/items (single, batch, changes feed).</summary>
public sealed class DevicesItemsTests : IDisposable
{
    private const string SetupToken = "test-setup-token";
    private const string NoSuchGuid = "0123456789abcdef0123456789abcdef";

    private readonly List<TestFactory> _factories = new();

    public void Dispose()
    {
        foreach (var f in _factories) f.Dispose();
        SqliteConnection.ClearAllPools();
    }

    // ---- helpers -----------------------------------------------------------------------

    private sealed record Creds(string Username, string AuthKeyB64, string SaltB64);
    private sealed record Account(Creds Creds, string Id, string AccessToken);

    private sealed class Host
    {
        public required TestFactory Factory { get; init; }
        public required HttpClient Http { get; init; }
        public required Account Admin { get; init; }
    }

    private static string RandB64(int n) => Convert.ToBase64String(RandomNumberGenerator.GetBytes(n));

    private static Creds NewCreds(string? username = null) => new(
        username ?? "user" + Guid.NewGuid().ToString("N")[..8], RandB64(32), RandB64(16));

    private static object CreateBody(Creds c, string? setupToken = null, string? inviteCode = null) => new
    {
        username = c.Username,
        salt = c.SaltB64,
        iterations = 600000,
        authKey = c.AuthKeyB64,
        publicKey = RandB64(91),
        wrappedPrivateKey = RandB64(120),
        wrappedContainerKey = RandB64(60),
        setupToken,
        inviteCode,
    };

    private static async Task<JsonElement> Json(HttpResponseMessage res) =>
        JsonDocument.Parse(await res.Content.ReadAsStringAsync()).RootElement.Clone();

    private static string Str(JsonElement j, string name) => j.GetProperty(name).GetString()!;

    private static Task<HttpResponseMessage> Send(HttpClient http, HttpMethod method, string url, string? token,
        object? body = null, string? ifMatch = null)
    {
        var req = new HttpRequestMessage(method, url);
        if (token != null) req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        if (ifMatch != null) req.Headers.TryAddWithoutValidation("If-Match", ifMatch);
        if (body != null) req.Content = JsonContent.Create(body);
        return http.SendAsync(req);
    }

    private async Task<Host> NewHost(Action<IDictionary<string, string?>>? configure = null)
    {
        var f = new TestFactory();
        configure?.Invoke(f.Overrides);
        _factories.Add(f);
        var http = f.CreateClient();
        var c = NewCreds("admin");
        var res = await http.PostAsJsonAsync("/api/account/setup", CreateBody(c, setupToken: SetupToken));
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        var s = await Json(res);
        return new Host
        {
            Factory = f, Http = http,
            Admin = new Account(c, Str(s.GetProperty("user"), "id"), Str(s, "accessToken")),
        };
    }

    private static async Task<Account> NewUser(Host h, string? username = null)
    {
        var inv = await Send(h.Http, HttpMethod.Post, "/api/admin/invites", h.Admin.AccessToken);
        Assert.Equal(HttpStatusCode.Created, inv.StatusCode);
        var code = Str(await Json(inv), "code");
        var c = NewCreds(username);
        var res = await h.Http.PostAsJsonAsync("/api/account/redeem", CreateBody(c, inviteCode: code));
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        var s = await Json(res);
        return new Account(c, Str(s.GetProperty("user"), "id"), Str(s, "accessToken"));
    }

    private static async Task<string> CreateDevice(Host h, Account a, string name = "Laptop", string platform = "windows")
    {
        var res = await Send(h.Http, HttpMethod.Post, "/api/devices", a.AccessToken, new { name, platform });
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        return Str(await Json(res), "id");
    }

    private static string Id(string seed) => seed.PadRight(8, 'x');

    private static async Task<(HttpStatusCode status, JsonElement body)> PutItem(
        Host h, Account a, string id, string ciphertext, long ifMatch, bool deleted = false)
    {
        var res = await Send(h.Http, HttpMethod.Put, $"/api/items/{id}", a.AccessToken,
            new { ciphertext, deleted }, ifMatch.ToString());
        var text = await res.Content.ReadAsStringAsync();
        return (res.StatusCode, text.Length == 0 ? default : JsonDocument.Parse(text).RootElement.Clone());
    }

    private static async Task<JsonElement> Changes(Host h, Account a, string query = "")
    {
        var res = await Send(h.Http, HttpMethod.Get, "/api/items/changes" + query, a.AccessToken);
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        return await Json(res);
    }

    private static async Task<JsonElement> Batch(Host h, Account a, object[] items)
    {
        var res = await Send(h.Http, HttpMethod.Post, "/api/items/batch", a.AccessToken, new { items });
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        return await Json(res);
    }

    private static void DisableUserInDb(TestFactory f, string userId)
    {
        using var conn = new SqliteConnection($"Data Source={Path.Combine(f.ContentRoot, "accounts.db")}");
        conn.Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "UPDATE Users SET Disabled=1 WHERE Id=$id";
        cmd.Parameters.AddWithValue("$id", userId);
        Assert.Equal(1, cmd.ExecuteNonQuery());
    }

    // ---- auth --------------------------------------------------------------------------

    public static IEnumerable<object[]> AllEndpoints() => new[]
    {
        new object[] { "GET",    "/api/devices" },
        new object[] { "POST",   "/api/devices" },
        new object[] { "PUT",    $"/api/devices/{NoSuchGuid}" },
        new object[] { "DELETE", $"/api/devices/{NoSuchGuid}" },
        new object[] { "GET",    $"/api/devices/{NoSuchGuid}/prefs" },
        new object[] { "PUT",    $"/api/devices/{NoSuchGuid}/prefs" },
        new object[] { "PUT",    "/api/items/abc" },
        new object[] { "POST",   "/api/items/batch" },
        new object[] { "GET",    "/api/items/changes" },
    };

    [Theory]
    [MemberData(nameof(AllEndpoints))]
    public async Task Anonymous_callers_get_401(string method, string url)
    {
        var h = await NewHost();
        var res = await Send(h.Http, new HttpMethod(method), url, token: null);
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
    }

    [Fact]
    public async Task Disabled_users_still_valid_token_is_rejected_immediately()
    {
        var h = await NewHost();
        var bob = await NewUser(h);
        var dev = await CreateDevice(h, bob);
        Assert.Equal(HttpStatusCode.OK, (await Send(h.Http, HttpMethod.Get, "/api/devices", bob.AccessToken)).StatusCode);

        DisableUserInDb(h.Factory, bob.Id);

        Assert.Equal(HttpStatusCode.Unauthorized, (await Send(h.Http, HttpMethod.Get, "/api/devices", bob.AccessToken)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized,
            (await Send(h.Http, HttpMethod.Get, $"/api/devices/{dev}/prefs", bob.AccessToken)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Send(h.Http, HttpMethod.Get, "/api/items/changes", bob.AccessToken)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await PutItem(h, bob, "abcdefgh", "ct", 0)).status);
    }

    // ---- devices -----------------------------------------------------------------------

    [Fact]
    public async Task Device_create_list_rename_delete_round_trip()
    {
        var h = await NewHost();
        var a = h.Admin;
        Assert.Equal(0, (await Json(await Send(h.Http, HttpMethod.Get, "/api/devices", a.AccessToken))).GetArrayLength());

        var create = await Send(h.Http, HttpMethod.Post, "/api/devices", a.AccessToken, new { name = "  Work laptop ", platform = "windows" });
        Assert.Equal(HttpStatusCode.Created, create.StatusCode);
        Assert.Contains("no-store", create.Headers.CacheControl?.ToString());
        var d = await Json(create);
        Assert.Equal(new[] { "id", "name", "platform", "updatedAt" },
            d.EnumerateObject().Select(p => p.Name).OrderBy(n => n).ToArray());
        Assert.Equal("Work laptop", Str(d, "name"));
        Assert.Equal("windows", Str(d, "platform"));
        var id = Str(d, "id");

        var list = await Json(await Send(h.Http, HttpMethod.Get, "/api/devices", a.AccessToken));
        Assert.Equal(id, Str(list.EnumerateArray().Single(), "id"));

        var rename = await Send(h.Http, HttpMethod.Put, $"/api/devices/{id}", a.AccessToken, new { name = "Home PC" });
        Assert.Equal(HttpStatusCode.OK, rename.StatusCode);
        Assert.Equal("Home PC", Str(await Json(rename), "name"));
        list = await Json(await Send(h.Http, HttpMethod.Get, "/api/devices", a.AccessToken));
        Assert.Equal("Home PC", Str(list.EnumerateArray().Single(), "name"));

        Assert.Equal(HttpStatusCode.NoContent, (await Send(h.Http, HttpMethod.Delete, $"/api/devices/{id}", a.AccessToken)).StatusCode);
        Assert.Equal(0, (await Json(await Send(h.Http, HttpMethod.Get, "/api/devices", a.AccessToken))).GetArrayLength());
        Assert.Equal(HttpStatusCode.NotFound, (await Send(h.Http, HttpMethod.Delete, $"/api/devices/{id}", a.AccessToken)).StatusCode);
    }

    [Theory]
    [InlineData("", "windows")]
    [InlineData("   ", "windows")]
    [InlineData("ok", "plan9")]
    [InlineData("ok", "Windows")]
    [InlineData("ok", null)]
    [InlineData(null, "web")]
    [InlineData("bad\u0007name", "web")]
    [InlineData("bad​name", "web")]   // zero-width space (format char)
    [InlineData("bad‮name", "web")]   // right-to-left override (format char)
    [InlineData("bad\nname", "web")]
    public async Task Device_create_validates_name_and_platform(string? name, string? platform)
    {
        var h = await NewHost();
        var res = await Send(h.Http, HttpMethod.Post, "/api/devices", h.Admin.AccessToken, new { name, platform });
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task Device_name_length_limit_is_64_after_trim()
    {
        var h = await NewHost();
        var ok = await Send(h.Http, HttpMethod.Post, "/api/devices", h.Admin.AccessToken, new { name = " " + new string('a', 64) + " ", platform = "android" });
        Assert.Equal(HttpStatusCode.Created, ok.StatusCode);
        var tooLong = await Send(h.Http, HttpMethod.Post, "/api/devices", h.Admin.AccessToken, new { name = new string('a', 65), platform = "other" });
        Assert.Equal(HttpStatusCode.BadRequest, tooLong.StatusCode);
        var id = await CreateDevice(h, h.Admin);
        var rename = await Send(h.Http, HttpMethod.Put, $"/api/devices/{id}", h.Admin.AccessToken, new { name = "" });
        Assert.Equal(HttpStatusCode.BadRequest, rename.StatusCode);
    }

    [Fact]
    public async Task A_user_can_have_at_most_50_devices()
    {
        var h = await NewHost();
        for (var i = 0; i < 50; i++) await CreateDevice(h, h.Admin, $"d{i}");
        var res = await Send(h.Http, HttpMethod.Post, "/api/devices", h.Admin.AccessToken, new { name = "one too many", platform = "web" });
        Assert.Equal(HttpStatusCode.Conflict, res.StatusCode);
        Assert.Equal("device_limit", Str(await Json(res), "code"));

        // The cap is per user, and deleting frees a slot.
        var bob = await NewUser(h);
        await CreateDevice(h, bob);
        var first = Str((await Json(await Send(h.Http, HttpMethod.Get, "/api/devices", h.Admin.AccessToken))).EnumerateArray().First(), "id");
        await Send(h.Http, HttpMethod.Delete, $"/api/devices/{first}", h.Admin.AccessToken);
        await CreateDevice(h, h.Admin, "fits again");
    }

    [Fact]
    public async Task Prefs_round_trip_with_revision_and_409_on_stale_if_match()
    {
        var h = await NewHost();
        var a = h.Admin;
        var dev = await CreateDevice(h, a);

        var get0 = await Send(h.Http, HttpMethod.Get, $"/api/devices/{dev}/prefs", a.AccessToken);
        Assert.Equal(HttpStatusCode.OK, get0.StatusCode);
        Assert.Contains("no-store", get0.Headers.CacheControl?.ToString());
        var p0 = await Json(get0);
        Assert.Equal(0, p0.GetProperty("revision").GetInt64());
        Assert.Equal("", Str(p0, "ciphertext"));

        var put1 = await Send(h.Http, HttpMethod.Put, $"/api/devices/{dev}/prefs", a.AccessToken, new { ciphertext = "AAA" }, "0");
        Assert.Equal(HttpStatusCode.OK, put1.StatusCode);
        Assert.Equal(1, (await Json(put1)).GetProperty("revision").GetInt64());

        var p1 = await Json(await Send(h.Http, HttpMethod.Get, $"/api/devices/{dev}/prefs", a.AccessToken));
        Assert.Equal(1, p1.GetProperty("revision").GetInt64());
        Assert.Equal("AAA", Str(p1, "ciphertext"));

        // Stale (0 again) -> 409 and nothing changes.
        var stale = await Send(h.Http, HttpMethod.Put, $"/api/devices/{dev}/prefs", a.AccessToken, new { ciphertext = "BBB" }, "0");
        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
        var put2 = await Send(h.Http, HttpMethod.Put, $"/api/devices/{dev}/prefs", a.AccessToken, new { ciphertext = "CCC" }, "1");
        Assert.Equal(2, (await Json(put2)).GetProperty("revision").GetInt64());
        Assert.Equal("CCC", Str(await Json(await Send(h.Http, HttpMethod.Get, $"/api/devices/{dev}/prefs", a.AccessToken)), "ciphertext"));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("abc")]
    [InlineData("-1")]
    public async Task Prefs_put_requires_a_valid_if_match(string? ifMatch)
    {
        var h = await NewHost();
        var dev = await CreateDevice(h, h.Admin);
        var res = await Send(h.Http, HttpMethod.Put, $"/api/devices/{dev}/prefs", h.Admin.AccessToken, new { ciphertext = "x" }, ifMatch);
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task Prefs_over_max_bytes_is_413()
    {
        var h = await NewHost(o => o["Items:MaxBytes"] = "16");
        var dev = await CreateDevice(h, h.Admin);
        var ok = await Send(h.Http, HttpMethod.Put, $"/api/devices/{dev}/prefs", h.Admin.AccessToken, new { ciphertext = new string('a', 16) }, "0");
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        var big = await Send(h.Http, HttpMethod.Put, $"/api/devices/{dev}/prefs", h.Admin.AccessToken, new { ciphertext = new string('a', 17) }, "1");
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, big.StatusCode);
    }

    [Fact]
    public async Task Concurrent_prefs_puts_with_the_same_if_match_produce_exactly_one_success()
    {
        var h = await NewHost();
        var dev = await CreateDevice(h, h.Admin);
        var results = await Task.WhenAll(Enumerable.Range(0, 8).Select(i =>
            Send(h.Http, HttpMethod.Put, $"/api/devices/{dev}/prefs", h.Admin.AccessToken, new { ciphertext = "c" + i }, "0")));
        Assert.Equal(1, results.Count(r => r.StatusCode == HttpStatusCode.OK));
        Assert.Equal(7, results.Count(r => r.StatusCode == HttpStatusCode.Conflict));
    }

    // ---- ownership: another user's resources are 404 -----------------------------------

    [Fact]
    public async Task Another_user_cannot_see_modify_or_delete_my_devices_prefs_or_items()
    {
        var h = await NewHost();
        var alice = await NewUser(h, "alice");
        var bob = await NewUser(h, "bob");
        var dev = await CreateDevice(h, alice, "alice phone", "android");
        await Send(h.Http, HttpMethod.Put, $"/api/devices/{dev}/prefs", alice.AccessToken, new { ciphertext = "secret-prefs" }, "0");
        Assert.Equal(HttpStatusCode.OK, (await PutItem(h, alice, "alice-item", "secret-item", 0)).status);

        // Bob's list does not include Alice's device.
        Assert.Equal(0, (await Json(await Send(h.Http, HttpMethod.Get, "/api/devices", bob.AccessToken))).GetArrayLength());
        Assert.Equal(HttpStatusCode.NotFound, (await Send(h.Http, HttpMethod.Put, $"/api/devices/{dev}", bob.AccessToken, new { name = "pwned" })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Send(h.Http, HttpMethod.Delete, $"/api/devices/{dev}", bob.AccessToken)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Send(h.Http, HttpMethod.Get, $"/api/devices/{dev}/prefs", bob.AccessToken)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Send(h.Http, HttpMethod.Put, $"/api/devices/{dev}/prefs", bob.AccessToken, new { ciphertext = "x" }, "1")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Send(h.Http, HttpMethod.Put, $"/api/devices/{dev}/prefs", bob.AccessToken, new { ciphertext = "x" }, "0")).StatusCode);

        // Malformed device ids are 404 too, never 400/500.
        foreach (var bad in new[] { "not-a-guid", "%01", new string('a', 500), "12345" })
        {
            Assert.Equal(HttpStatusCode.NotFound, (await Send(h.Http, HttpMethod.Get, $"/api/devices/{bad}/prefs", bob.AccessToken)).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await Send(h.Http, HttpMethod.Delete, $"/api/devices/{bad}", bob.AccessToken)).StatusCode);
        }

        // Alice's data is intact.
        Assert.Equal("alice phone", Str((await Json(await Send(h.Http, HttpMethod.Get, "/api/devices", alice.AccessToken))).EnumerateArray().Single(), "name"));
        Assert.Equal("secret-prefs", Str(await Json(await Send(h.Http, HttpMethod.Get, $"/api/devices/{dev}/prefs", alice.AccessToken)), "ciphertext"));

        // Items are per user: Bob's feed never contains Alice's and the same id is an independent item for him.
        Assert.Equal(0, (await Changes(h, bob)).GetProperty("items").GetArrayLength());
        var bobSame = await PutItem(h, bob, "alice-item", "bob-version", 0);
        Assert.Equal(HttpStatusCode.OK, bobSame.status);
        Assert.Equal(1, bobSame.body.GetProperty("revision").GetInt64());
        var aliceFeed = (await Changes(h, alice)).GetProperty("items");
        Assert.Equal("secret-item", Str(aliceFeed.EnumerateArray().Single(), "ciphertext"));
        var bobFeed = (await Changes(h, bob)).GetProperty("items");
        Assert.Equal("bob-version", Str(bobFeed.EnumerateArray().Single(), "ciphertext"));
        // Bob cannot update Alice's item by guessing the revision: his own copy is at 1, a write with Alice's rev conflicts only on his own row.
        Assert.Equal(HttpStatusCode.Conflict, (await PutItem(h, bob, "alice-item", "x", 0)).status);
    }

    // ---- items: single put -------------------------------------------------------------

    [Fact]
    public async Task Item_create_update_and_stale_409()
    {
        var h = await NewHost();
        var a = h.Admin;

        var (s1, b1) = await PutItem(h, a, "item-one", "v1", 0);
        Assert.Equal(HttpStatusCode.OK, s1);
        Assert.Equal(new[] { "cursor", "revision" }, b1.EnumerateObject().Select(p => p.Name).OrderBy(n => n).ToArray());
        Assert.Equal(1, b1.GetProperty("revision").GetInt64());
        Assert.Equal(1, b1.GetProperty("cursor").GetInt64());

        // Creating again with 0 is stale.
        Assert.Equal(HttpStatusCode.Conflict, (await PutItem(h, a, "item-one", "dup", 0)).status);

        var (s2, b2) = await PutItem(h, a, "item-one", "v2", 1);
        Assert.Equal(HttpStatusCode.OK, s2);
        Assert.Equal(2, b2.GetProperty("revision").GetInt64());
        Assert.Equal(2, b2.GetProperty("cursor").GetInt64());

        // Stale (1) and ahead-of-server (9) both conflict; updating a missing item with ifMatch>0 too.
        Assert.Equal(HttpStatusCode.Conflict, (await PutItem(h, a, "item-one", "x", 1)).status);
        Assert.Equal(HttpStatusCode.Conflict, (await PutItem(h, a, "item-one", "x", 9)).status);
        Assert.Equal(HttpStatusCode.Conflict, (await PutItem(h, a, "missing-item", "x", 1)).status);

        var feed = (await Changes(h, a)).GetProperty("items");
        var item = feed.EnumerateArray().Single();
        Assert.Equal("v2", Str(item, "ciphertext"));
        Assert.Equal(2, item.GetProperty("revision").GetInt64());
        Assert.False(item.GetProperty("deleted").GetBoolean());
        Assert.Equal(new[] { "ciphertext", "cursor", "deleted", "id", "revision", "updatedAt" },
            item.EnumerateObject().Select(p => p.Name).OrderBy(n => n).ToArray());
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("abc")]
    [InlineData("-1")]
    [InlineData("1.5")]
    public async Task Item_put_requires_a_valid_if_match(string? ifMatch)
    {
        var h = await NewHost();
        var res = await Send(h.Http, HttpMethod.Put, "/api/items/abcdefgh", h.Admin.AccessToken, new { ciphertext = "x", deleted = false }, ifMatch);
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task Item_put_requires_a_ciphertext()
    {
        var h = await NewHost();
        Assert.Equal(HttpStatusCode.BadRequest,
            (await Send(h.Http, HttpMethod.Put, "/api/items/abcdefgh", h.Admin.AccessToken, new { deleted = false }, "0")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await Send(h.Http, HttpMethod.Put, "/api/items/abcdefgh", h.Admin.AccessToken, new { ciphertext = "", deleted = false }, "0")).StatusCode);
    }

    [Fact]
    public async Task Item_ids_are_validated_as_1_to_128_base64url_characters()
    {
        var h = await NewHost();
        var a = h.Admin;
        Assert.Equal(HttpStatusCode.OK, (await PutItem(h, a, "A-z_09", "x", 0)).status);
        Assert.Equal(HttpStatusCode.OK, (await PutItem(h, a, "a", "x", 0)).status);
        Assert.Equal(HttpStatusCode.OK, (await PutItem(h, a, new string('b', 128), "x", 0)).status);
        Assert.Equal(HttpStatusCode.BadRequest, (await PutItem(h, a, new string('b', 129), "x", 0)).status);
        foreach (var bad in new[] { "a.b", "a%20b", "a+b", "a=b", "a%2Fb", "a:b", "%C3%A9" })
            Assert.Equal(HttpStatusCode.BadRequest, (await PutItem(h, a, bad, "x", 0)).status);
    }

    [Fact]
    public async Task Item_over_max_bytes_is_413()
    {
        var h = await NewHost(o => o["Items:MaxBytes"] = "32");
        Assert.Equal(HttpStatusCode.OK, (await PutItem(h, h.Admin, "small-one", new string('a', 32), 0)).status);
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, (await PutItem(h, h.Admin, "large-one", new string('a', 33), 0)).status);
        // The rejected write stored nothing.
        Assert.Equal(1, (await Changes(h, h.Admin)).GetProperty("items").GetArrayLength());
    }

    [Fact]
    public async Task Tombstone_keeps_its_ciphertext_and_the_item_can_be_undeleted()
    {
        var h = await NewHost();
        var a = h.Admin;
        Assert.Equal(HttpStatusCode.OK, (await PutItem(h, a, "doc-one", "live-payload", 0)).status);

        var (ds, db) = await PutItem(h, a, "doc-one", "tombstone-payload", 1, deleted: true);
        Assert.Equal(HttpStatusCode.OK, ds);
        Assert.Equal(2, db.GetProperty("revision").GetInt64());

        var item = (await Changes(h, a)).GetProperty("items").EnumerateArray().Single();
        Assert.True(item.GetProperty("deleted").GetBoolean());
        Assert.Equal("tombstone-payload", Str(item, "ciphertext"));
        Assert.Equal(2, item.GetProperty("revision").GetInt64());

        // Undelete: PUT again with the current revision; revision keeps incrementing.
        var (us, ub) = await PutItem(h, a, "doc-one", "revived-payload", 2);
        Assert.Equal(HttpStatusCode.OK, us);
        Assert.Equal(3, ub.GetProperty("revision").GetInt64());
        item = (await Changes(h, a)).GetProperty("items").EnumerateArray().Single();
        Assert.False(item.GetProperty("deleted").GetBoolean());
        Assert.Equal("revived-payload", Str(item, "ciphertext"));
        // Creating over a tombstone with ifMatch 0 is still a conflict.
        Assert.Equal(HttpStatusCode.Conflict, (await PutItem(h, a, "doc-one", "x", 0)).status);
    }

    [Fact]
    public async Task Concurrent_item_puts_with_the_same_if_match_produce_exactly_one_success()
    {
        var h = await NewHost();
        var results = await Task.WhenAll(Enumerable.Range(0, 8).Select(i =>
            PutItem(h, h.Admin, "race-item", "c" + i, 0)));
        Assert.Equal(1, results.Count(r => r.status == HttpStatusCode.OK));
        Assert.Equal(7, results.Count(r => r.status == HttpStatusCode.Conflict));

        // Same for an update of the now-existing item.
        var more = await Task.WhenAll(Enumerable.Range(0, 8).Select(i =>
            PutItem(h, h.Admin, "race-item", "u" + i, 1)));
        Assert.Equal(1, more.Count(r => r.status == HttpStatusCode.OK));
        Assert.Equal(2, (await Changes(h, h.Admin)).GetProperty("items").EnumerateArray().Single().GetProperty("revision").GetInt64());
    }

    [Fact]
    public async Task Concurrent_writes_to_different_items_get_distinct_cursors()
    {
        var h = await NewHost();
        var results = await Task.WhenAll(Enumerable.Range(0, 12).Select(i =>
            PutItem(h, h.Admin, "par-" + i, "c", 0)));
        Assert.All(results, r => Assert.True(r.status == HttpStatusCode.OK, $"status {r.status}: {r.body}"));
        var cursors = results.Select(r => r.body.GetProperty("cursor").GetInt64()).OrderBy(c => c).ToArray();
        Assert.Equal(Enumerable.Range(1, 12).Select(i => (long)i).ToArray(), cursors);
    }

    // ---- items: changes feed -----------------------------------------------------------

    [Fact]
    public async Task Changes_returns_only_newer_items_with_a_non_decreasing_cursor()
    {
        var h = await NewHost();
        var a = h.Admin;
        var empty = await Changes(h, a);
        Assert.Equal(0, empty.GetProperty("items").GetArrayLength());
        Assert.Equal(0, empty.GetProperty("cursor").GetInt64());

        await PutItem(h, a, "item-aaa", "a1", 0);   // cursor 1
        await PutItem(h, a, "item-bbb", "b1", 0);   // cursor 2
        var all = await Changes(h, a, "?since=0");
        Assert.Equal(2, all.GetProperty("items").GetArrayLength());
        var c1 = all.GetProperty("cursor").GetInt64();
        Assert.Equal(2, c1);
        Assert.Contains("no-store", (await Send(h.Http, HttpMethod.Get, "/api/items/changes", a.AccessToken)).Headers.CacheControl?.ToString());

        // Nothing new: empty page, cursor stays at since.
        var none = await Changes(h, a, $"?since={c1}");
        Assert.Equal(0, none.GetProperty("items").GetArrayLength());
        Assert.Equal(c1, none.GetProperty("cursor").GetInt64());

        // Updating item-aaa moves it past the old cursor, and only it is returned.
        await PutItem(h, a, "item-aaa", "a2", 1);   // cursor 3
        var newer = await Changes(h, a, $"?since={c1}");
        var only = newer.GetProperty("items").EnumerateArray().Single();
        Assert.Equal("item-aaa", Str(only, "id"));
        Assert.Equal("a2", Str(only, "ciphertext"));
        Assert.Equal(3, only.GetProperty("cursor").GetInt64());
        Assert.Equal(3, newer.GetProperty("cursor").GetInt64());
        // Each id appears once in a full feed (latest version), ordered by cursor.
        var full = (await Changes(h, a)).GetProperty("items").EnumerateArray().Select(i => Str(i, "id")).ToArray();
        Assert.Equal(new[] { "item-bbb", "item-aaa" }, full);
    }

    [Fact]
    public async Task Changes_pages_by_limit_and_the_cursor_is_the_highest_in_the_page()
    {
        var h = await NewHost();
        for (var i = 0; i < 5; i++) await PutItem(h, h.Admin, "pg-" + i, "c", 0);

        var seen = new List<string>();
        long cursor = 0;
        var pages = 0;
        while (true)
        {
            var page = await Changes(h, h.Admin, $"?since={cursor}&limit=2");
            var items = page.GetProperty("items").EnumerateArray().ToArray();
            seen.AddRange(items.Select(i => Str(i, "id")));
            Assert.True(page.GetProperty("cursor").GetInt64() >= cursor);
            cursor = page.GetProperty("cursor").GetInt64();
            pages++;
            if (items.Length < 2) break;
        }
        Assert.Equal(new[] { "pg-0", "pg-1", "pg-2", "pg-3", "pg-4" }, seen);
        Assert.Equal(3, pages);
        Assert.Equal(5, cursor);
    }

    [Fact]
    public async Task Changes_limit_defaults_to_500_and_is_capped_at_1000()
    {
        var h = await NewHost();
        // 1001 writes via 11 batches.
        for (var b = 0; b < 11; b++)
        {
            var count = b == 10 ? 1 : 100;
            await Batch(h, h.Admin, Enumerable.Range(0, count).Select(i => (object)new
            { id = $"bulk-{b}-{i}", ifMatch = 0, ciphertext = "c", deleted = false }).ToArray());
        }
        Assert.Equal(500, (await Changes(h, h.Admin)).GetProperty("items").GetArrayLength());
        Assert.Equal(1000, (await Changes(h, h.Admin, "?limit=5000")).GetProperty("items").GetArrayLength());
        Assert.Equal(1000, (await Changes(h, h.Admin, "?limit=1000")).GetProperty("items").GetArrayLength());
        Assert.Equal(1, (await Changes(h, h.Admin, "?limit=1")).GetProperty("items").GetArrayLength());
    }

    [Theory]
    [InlineData("?since=-1")]
    [InlineData("?since=abc")]
    [InlineData("?since=1.5")]
    [InlineData("?since=")]
    [InlineData("?since=99999999999999999999999")]
    [InlineData("?limit=0")]
    [InlineData("?limit=-5")]
    [InlineData("?limit=abc")]
    public async Task Changes_validates_since_and_limit(string query)
    {
        var h = await NewHost();
        var res = await Send(h.Http, HttpMethod.Get, "/api/items/changes" + query, h.Admin.AccessToken);
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task Cursor_is_per_user_and_monotonic_across_creates_updates_and_deletes()
    {
        var h = await NewHost();
        var alice = await NewUser(h);
        var bob = await NewUser(h);
        var cursors = new List<long>();
        long Cur((HttpStatusCode s, JsonElement b) r) { Assert.Equal(HttpStatusCode.OK, r.s); return r.b.GetProperty("cursor").GetInt64(); }

        cursors.Add(Cur(await PutItem(h, alice, "mono-aa", "1", 0)));
        cursors.Add(Cur(await PutItem(h, alice, "mono-bb", "1", 0)));
        cursors.Add(Cur(await PutItem(h, alice, "mono-aa", "2", 1)));
        cursors.Add(Cur(await PutItem(h, alice, "mono-bb", "tomb", 1, deleted: true)));
        Assert.Equal(new long[] { 1, 2, 3, 4 }, cursors);

        // Bob's counter is independent.
        Assert.Equal(1, Cur(await PutItem(h, bob, "mono-aa", "b", 0)));
        Assert.Equal(1, (await Changes(h, bob)).GetProperty("cursor").GetInt64());
        Assert.Equal(4, (await Changes(h, alice)).GetProperty("cursor").GetInt64());

        // A rejected (conflicting) write does not burn a cursor.
        Assert.Equal(HttpStatusCode.Conflict, (await PutItem(h, alice, "mono-aa", "stale", 1)).status);
        Assert.Equal(5, Cur(await PutItem(h, alice, "mono-aa", "3", 2)));
    }

    // ---- items: batch ------------------------------------------------------------------

    [Fact]
    public async Task Batch_results_are_independent_ok_conflict_too_large_invalid()
    {
        var h = await NewHost(o => o["Items:MaxBytes"] = "10");
        var a = h.Admin;
        await PutItem(h, a, "existing", "v1", 0);

        var body = await Batch(h, a, new object[]
        {
            new { id = "fresh-one", ifMatch = 0, ciphertext = "ok", deleted = false },
            new { id = "existing", ifMatch = 0, ciphertext = "stale", deleted = false },     // conflict
            new { id = "huge-one", ifMatch = 0, ciphertext = new string('z', 11), deleted = false }, // too_large
            new { id = "bad id!", ifMatch = 0, ciphertext = "ok", deleted = false },          // invalid
            new { id = "neg-match", ifMatch = -1, ciphertext = "ok", deleted = false },       // invalid
            new { id = "no-ciphertext", ifMatch = 0, ciphertext = "", deleted = false },      // invalid
            new { id = "existing", ifMatch = 1, ciphertext = "tomb", deleted = true },        // ok (revision 2)
            new { id = "last-one", ifMatch = 0, ciphertext = "ok", deleted = false },         // ok
        });

        var r = body.GetProperty("results").EnumerateArray().ToArray();
        Assert.Equal(8, r.Length);
        Assert.Equal(new[] { "ok", "conflict", "too_large", "invalid", "invalid", "invalid", "ok", "ok" },
            r.Select(x => Str(x, "status")).ToArray());
        Assert.Equal(new[] { "fresh-one", "existing", "huge-one", "bad id!", "neg-match", "no-ciphertext", "existing", "last-one" },
            r.Select(x => Str(x, "id")).ToArray());
        Assert.Equal(1, r[0].GetProperty("revision").GetInt64());
        Assert.Equal(2, r[6].GetProperty("revision").GetInt64());
        // cursors only for successful writes, assigned in order after the earlier single put (cursor 1).
        Assert.Equal(2, r[0].GetProperty("cursor").GetInt64());
        Assert.Equal(3, r[6].GetProperty("cursor").GetInt64());
        Assert.Equal(4, r[7].GetProperty("cursor").GetInt64());

        // The ok ones were stored despite the failures around them; the failed ones were not.
        var ids = (await Changes(h, a)).GetProperty("items").EnumerateArray().Select(i => Str(i, "id")).ToArray();
        Assert.Equal(new[] { "fresh-one", "existing", "last-one" }, ids);
        var existing = (await Changes(h, a)).GetProperty("items").EnumerateArray().Single(i => Str(i, "id") == "existing");
        Assert.True(existing.GetProperty("deleted").GetBoolean());
        Assert.Equal("tomb", Str(existing, "ciphertext"));
    }

    [Fact]
    public async Task Batch_is_capped_at_100_items()
    {
        var h = await NewHost();
        object Item(int i) => new { id = "cap-" + i, ifMatch = 0, ciphertext = "c", deleted = false };
        var ok = await Batch(h, h.Admin, Enumerable.Range(0, 100).Select(Item).ToArray());
        Assert.Equal(100, ok.GetProperty("results").GetArrayLength());

        var res = await Send(h.Http, HttpMethod.Post, "/api/items/batch", h.Admin.AccessToken,
            new { items = Enumerable.Range(100, 101).Select(Item).ToArray() });
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        // nothing from the rejected batch was stored
        Assert.Equal(100, (await Changes(h, h.Admin, "?limit=1000")).GetProperty("items").GetArrayLength());
    }

    [Fact]
    public async Task Batch_requires_items_and_empty_batch_is_ok()
    {
        var h = await NewHost();
        Assert.Equal(HttpStatusCode.BadRequest,
            (await Send(h.Http, HttpMethod.Post, "/api/items/batch", h.Admin.AccessToken, new { })).StatusCode);
        var empty = await Batch(h, h.Admin, Array.Empty<object>());
        Assert.Equal(0, empty.GetProperty("results").GetArrayLength());
    }

    [Fact]
    public async Task Batch_total_request_body_is_capped()
    {
        var h = await NewHost(o => { o["Items:MaxBytes"] = "1000"; o["Items:MaxBatchBytes"] = "2000"; });
        var res = await Send(h.Http, HttpMethod.Post, "/api/items/batch", h.Admin.AccessToken, new
        {
            items = Enumerable.Range(0, 5).Select(i => new { id = "big-" + i, ifMatch = 0, ciphertext = new string('a', 900), deleted = false }).ToArray(),
        });
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, res.StatusCode);
        Assert.Equal(0, (await Changes(h, h.Admin)).GetProperty("items").GetArrayLength());
    }

    [Fact]
    public async Task Batch_writes_are_scoped_to_the_caller()
    {
        var h = await NewHost();
        var alice = await NewUser(h);
        var bob = await NewUser(h);
        await Batch(h, alice, new object[] { new { id = "shared-id", ifMatch = 0, ciphertext = "alice", deleted = false } });
        var r = await Batch(h, bob, new object[] { new { id = "shared-id", ifMatch = 1, ciphertext = "bob", deleted = false } });
        // Bob has no such item, so ifMatch 1 conflicts; Alice's row is untouched.
        Assert.Equal("conflict", Str(r.GetProperty("results")[0], "status"));
        Assert.Equal("alice", Str((await Changes(h, alice)).GetProperty("items")[0], "ciphertext"));
        Assert.Equal(0, (await Changes(h, bob)).GetProperty("items").GetArrayLength());
    }
}
