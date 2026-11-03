using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.DependencyInjection;
using NexusMDWeb.Api.Data;
using NexusMDWeb.Tests.Infrastructure;
using Xunit;

namespace NexusMDWeb.Tests;

/// <summary>HTTP-level tests for /api/admin (invites and user management).</summary>
public sealed class AdminControllerTests : IDisposable
{
    private const string SetupToken = "test-setup-token";
    private const string Base32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

    private readonly List<TestFactory> _factories = new();

    public void Dispose()
    {
        foreach (var f in _factories) f.Dispose();
        SqliteConnection.ClearAllPools();
    }

    // ---- helpers -----------------------------------------------------------------------

    private sealed record Creds(string Username, byte[] AuthKey, byte[] Salt, int Iterations,
                                string PublicKey, string WrappedPrivateKey, string WrappedContainerKey)
    {
        public string AuthKeyB64 => Convert.ToBase64String(AuthKey);
        public string SaltB64 => Convert.ToBase64String(Salt);
    }

    /// <summary>An authenticated principal: its credentials, user id and current session tokens.</summary>
    private sealed record Account(Creds Creds, string Id, string AccessToken, string RefreshToken);

    private sealed class Host
    {
        public required TestFactory Factory { get; init; }
        public required HttpClient Http { get; init; }
        public required Account Admin { get; init; }
    }

    private static string RandB64(int n) => Convert.ToBase64String(RandomNumberGenerator.GetBytes(n));

    private static Creds NewCreds(string? username = null) => new(
        username ?? "user" + Guid.NewGuid().ToString("N")[..8],
        RandomNumberGenerator.GetBytes(32), RandomNumberGenerator.GetBytes(16), 600000,
        RandB64(91), RandB64(120), RandB64(60));

    private static object CreateBody(Creds c, string? setupToken = null, string? inviteCode = null) => new
    {
        username = c.Username,
        salt = c.SaltB64,
        iterations = c.Iterations,
        authKey = c.AuthKeyB64,
        publicKey = c.PublicKey,
        wrappedPrivateKey = c.WrappedPrivateKey,
        wrappedContainerKey = c.WrappedContainerKey,
        setupToken,
        inviteCode,
    };

    private static async Task<JsonElement> Json(HttpResponseMessage res) =>
        JsonDocument.Parse(await res.Content.ReadAsStringAsync()).RootElement.Clone();

    private static string Str(JsonElement j, string name) => j.GetProperty(name).GetString()!;

    private static Account ToAccount(Creds c, JsonElement session) => new(
        c, Str(session.GetProperty("user"), "id"), Str(session, "accessToken"), Str(session, "refreshToken"));

    private static Task<HttpResponseMessage> Send(HttpClient http, HttpMethod method, string url, string? token, object? body = null)
    {
        var req = new HttpRequestMessage(method, url);
        if (token != null) req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        if (body != null) req.Content = JsonContent.Create(body);
        return http.SendAsync(req);
    }

    private async Task<Host> NewHost()
    {
        var f = new TestFactory();
        _factories.Add(f);
        var http = f.CreateClient();
        var c = NewCreds("admin");
        var res = await http.PostAsJsonAsync("/api/account/setup", CreateBody(c, setupToken: SetupToken));
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        return new Host { Factory = f, Http = http, Admin = ToAccount(c, await Json(res)) };
    }

    /// <summary>Creates an invite through the admin API and returns (invite id, code).</summary>
    private static async Task<(string id, string code)> CreateInvite(Host h, object? body = null)
    {
        var res = await Send(h.Http, HttpMethod.Post, "/api/admin/invites", h.Admin.AccessToken, body);
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        var j = await Json(res);
        return (Str(j, "id"), Str(j, "code"));
    }

    /// <summary>Registers a normal user through an admin-created invite.</summary>
    private static async Task<Account> NewUser(Host h, string? username = null)
    {
        var (_, code) = await CreateInvite(h);
        var c = NewCreds(username);
        var res = await h.Http.PostAsJsonAsync("/api/account/redeem", CreateBody(c, inviteCode: code));
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        return ToAccount(c, await Json(res));
    }

    private static Task<HttpResponseMessage> Login(HttpClient http, Creds c) =>
        http.PostAsJsonAsync("/api/account/login", new { username = c.Username, authKey = c.AuthKeyB64 });

    private static Task<HttpResponseMessage> Refresh(HttpClient http, string refreshToken) =>
        http.PostAsJsonAsync("/api/account/refresh", new { refreshToken });

    /// <summary>Test-only role change straight in SQLite (there is deliberately no API for it yet).</summary>
    private static void SetRole(TestFactory f, string userId, string role)
    {
        using var conn = new SqliteConnection($"Data Source={Path.Combine(f.ContentRoot, "accounts.db")}");
        conn.Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "UPDATE Users SET Role=$r WHERE Id=$id";
        cmd.Parameters.AddWithValue("$r", role);
        cmd.Parameters.AddWithValue("$id", userId);
        Assert.Equal(1, cmd.ExecuteNonQuery());
    }

    public static IEnumerable<object[]> AllEndpoints() => new[]
    {
        new object[] { "POST",   "/api/admin/invites" },
        new object[] { "GET",    "/api/admin/invites" },
        new object[] { "DELETE", "/api/admin/invites/0123456789abcdef0123456789abcdef" },
        new object[] { "GET",    "/api/admin/users" },
        new object[] { "POST",   "/api/admin/users/0123456789abcdef0123456789abcdef/disable" },
        new object[] { "POST",   "/api/admin/users/0123456789abcdef0123456789abcdef/enable" },
    };

    // ---- authorization -----------------------------------------------------------------

    [Theory]
    [MemberData(nameof(AllEndpoints))]
    public async Task Anonymous_callers_get_401(string method, string url)
    {
        var h = await NewHost();
        var res = await Send(h.Http, new HttpMethod(method), url, token: null);
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
    }

    [Theory]
    [MemberData(nameof(AllEndpoints))]
    public async Task Non_admin_users_get_403(string method, string url)
    {
        var h = await NewHost();
        var user = await NewUser(h);
        var res = await Send(h.Http, new HttpMethod(method), url, user.AccessToken);
        Assert.Equal(HttpStatusCode.Forbidden, res.StatusCode);
    }

    [Fact]
    public async Task Demoted_admin_with_a_still_valid_access_token_is_rejected_immediately()
    {
        var h = await NewHost();
        var second = await NewUser(h, "second");
        SetRole(h.Factory, second.Id, "admin");

        // A fresh login picks up the admin role; the token is valid and works.
        var login = await Login(h.Http, second.Creds);
        var token = Str(await Json(login), "accessToken");
        Assert.Equal(HttpStatusCode.OK, (await Send(h.Http, HttpMethod.Get, "/api/admin/users", token)).StatusCode);

        SetRole(h.Factory, second.Id, "user"); // demoted; the 15-minute token still says role=admin

        Assert.Equal(HttpStatusCode.Forbidden, (await Send(h.Http, HttpMethod.Get, "/api/admin/users", token)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(h.Http, HttpMethod.Post, "/api/admin/invites", token)).StatusCode);
    }

    [Fact]
    public async Task Disabled_admin_with_a_still_valid_access_token_is_rejected_immediately()
    {
        var h = await NewHost();
        var second = await NewUser(h, "second");
        SetRole(h.Factory, second.Id, "admin");
        var token = Str(await Json(await Login(h.Http, second.Creds)), "accessToken");
        Assert.Equal(HttpStatusCode.OK, (await Send(h.Http, HttpMethod.Get, "/api/admin/users", token)).StatusCode);

        Assert.Equal(HttpStatusCode.NoContent,
            (await Send(h.Http, HttpMethod.Post, $"/api/admin/users/{second.Id}/disable", h.Admin.AccessToken)).StatusCode);

        Assert.Equal(HttpStatusCode.Unauthorized, (await Send(h.Http, HttpMethod.Get, "/api/admin/users", token)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Send(h.Http, HttpMethod.Post, "/api/admin/invites", token)).StatusCode);
    }

    // ---- invites -----------------------------------------------------------------------

    [Fact]
    public async Task Created_invite_returns_the_code_once_and_redeems()
    {
        var h = await NewHost();
        var res = await Send(h.Http, HttpMethod.Post, "/api/admin/invites", h.Admin.AccessToken, new { });
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        Assert.Contains("no-store", res.Headers.CacheControl?.ToString() ?? "");
        var j = await Json(res);

        var code = Str(j, "code");
        Assert.Equal(24, code.Length);
        Assert.All(code, ch => Assert.Contains(ch, Base32));
        Assert.False(string.IsNullOrEmpty(Str(j, "id")));
        var expiresAt = j.GetProperty("expiresAt").GetDateTime().ToUniversalTime();
        Assert.InRange((expiresAt - DateTime.UtcNow).TotalHours, 167.9, 168.1);
        Assert.Equal(new[] { "code", "expiresAt", "id" }, j.EnumerateObject().Select(p => p.Name).OrderBy(n => n).ToArray());

        var c = NewCreds("newbie");
        var redeem = await h.Http.PostAsJsonAsync("/api/account/redeem", CreateBody(c, inviteCode: code));
        Assert.Equal(HttpStatusCode.Created, redeem.StatusCode);
        var role = (await Json(redeem)).GetProperty("user").GetProperty("role").GetString();
        Assert.Equal("user", role);
    }

    [Fact]
    public async Task Invite_can_be_created_without_a_request_body()
    {
        var h = await NewHost();
        var res = await Send(h.Http, HttpMethod.Post, "/api/admin/invites", h.Admin.AccessToken);
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
    }

    [Fact]
    public async Task Invite_listing_has_metadata_only_and_never_the_code_or_its_hash()
    {
        var h = await NewHost();
        var (id, code) = await CreateInvite(h, new { ttlHours = 2 });

        var res = await Send(h.Http, HttpMethod.Get, "/api/admin/invites", h.Admin.AccessToken);
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var text = await res.Content.ReadAsStringAsync();
        Assert.DoesNotContain(code, text);
        Assert.DoesNotContain(code.ToLowerInvariant(), text);
        Assert.DoesNotContain("codehash", text, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("\"code\"", text, StringComparison.OrdinalIgnoreCase);

        var item = JsonDocument.Parse(text).RootElement.EnumerateArray().Single(e => Str(e, "id") == id);
        Assert.Equal(h.Admin.Id, Str(item, "createdBy"));
        Assert.True(item.TryGetProperty("createdAt", out _));
        Assert.True(item.TryGetProperty("expiresAt", out _));
        Assert.Equal(JsonValueKind.Null, item.GetProperty("redeemedAt").ValueKind);
    }

    [Fact]
    public async Task Invite_listing_shows_when_an_invite_was_redeemed()
    {
        var h = await NewHost();
        var (id, code) = await CreateInvite(h);
        await h.Http.PostAsJsonAsync("/api/account/redeem", CreateBody(NewCreds(), inviteCode: code));

        var list = await Json(await Send(h.Http, HttpMethod.Get, "/api/admin/invites", h.Admin.AccessToken));
        var item = list.EnumerateArray().Single(e => Str(e, "id") == id);
        Assert.NotEqual(JsonValueKind.Null, item.GetProperty("redeemedAt").ValueKind);
    }

    [Fact]
    public async Task Revoked_invite_cannot_be_redeemed_and_leaves_the_listing()
    {
        var h = await NewHost();
        var (id, code) = await CreateInvite(h);

        var del = await Send(h.Http, HttpMethod.Delete, $"/api/admin/invites/{id}", h.Admin.AccessToken);
        Assert.Equal(HttpStatusCode.NoContent, del.StatusCode);

        var redeem = await h.Http.PostAsJsonAsync("/api/account/redeem", CreateBody(NewCreds(), inviteCode: code));
        Assert.Equal(HttpStatusCode.BadRequest, redeem.StatusCode);

        var list = await Json(await Send(h.Http, HttpMethod.Get, "/api/admin/invites", h.Admin.AccessToken));
        Assert.DoesNotContain(list.EnumerateArray(), e => Str(e, "id") == id);

        // Revoking again, or a redeemed invite, is a 404.
        Assert.Equal(HttpStatusCode.NotFound,
            (await Send(h.Http, HttpMethod.Delete, $"/api/admin/invites/{id}", h.Admin.AccessToken)).StatusCode);
    }

    [Fact]
    public async Task Redeemed_invite_cannot_be_revoked()
    {
        var h = await NewHost();
        var (id, code) = await CreateInvite(h);
        await h.Http.PostAsJsonAsync("/api/account/redeem", CreateBody(NewCreds(), inviteCode: code));
        Assert.Equal(HttpStatusCode.NotFound,
            (await Send(h.Http, HttpMethod.Delete, $"/api/admin/invites/{id}", h.Admin.AccessToken)).StatusCode);
    }

    [Theory]
    [InlineData("0123456789abcdef0123456789abcdef")]
    [InlineData("not-a-guid")]
    [InlineData("%27%20OR%201=1--")]
    public async Task Revoking_an_unknown_or_malformed_invite_id_is_404(string id)
    {
        var h = await NewHost();
        var res = await Send(h.Http, HttpMethod.Delete, $"/api/admin/invites/{id}", h.Admin.AccessToken);
        Assert.Equal(HttpStatusCode.NotFound, res.StatusCode);
    }

    [Theory]
    [InlineData(1, true)]
    [InlineData(720, true)]
    [InlineData(0, false)]
    [InlineData(-1, false)]
    [InlineData(721, false)]
    [InlineData(int.MaxValue, false)]
    public async Task Ttl_hours_must_be_between_1_and_720(int ttl, bool ok)
    {
        var h = await NewHost();
        var res = await Send(h.Http, HttpMethod.Post, "/api/admin/invites", h.Admin.AccessToken, new { ttlHours = ttl });
        Assert.Equal(ok ? HttpStatusCode.Created : HttpStatusCode.BadRequest, res.StatusCode);
        if (ok)
        {
            var expiresAt = (await Json(res)).GetProperty("expiresAt").GetDateTime().ToUniversalTime();
            Assert.InRange((expiresAt - DateTime.UtcNow).TotalHours, ttl - 0.1, ttl + 0.1);
        }
    }

    [Fact]
    public async Task Non_integer_ttl_is_400()
    {
        var h = await NewHost();
        foreach (var body in new object[] { new { ttlHours = "abc" }, new { ttlHours = 1.5 } })
        {
            var res = await Send(h.Http, HttpMethod.Post, "/api/admin/invites", h.Admin.AccessToken, body);
            Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        }
    }

    // ---- users -------------------------------------------------------------------------

    [Fact]
    public async Task User_listing_contains_only_public_fields()
    {
        var h = await NewHost();
        var bob = await NewUser(h, "bob");

        var res = await Send(h.Http, HttpMethod.Get, "/api/admin/users", h.Admin.AccessToken);
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var text = await res.Content.ReadAsStringAsync();
        var users = JsonDocument.Parse(text).RootElement.EnumerateArray().ToArray();

        Assert.Equal(2, users.Length);
        foreach (var u in users)
            Assert.Equal(new[] { "createdAt", "disabled", "id", "role", "username" },
                u.EnumerateObject().Select(p => p.Name).OrderBy(n => n).ToArray());

        var b = users.Single(u => Str(u, "id") == bob.Id);
        Assert.Equal("bob", Str(b, "username"));
        Assert.Equal("user", Str(b, "role"));
        Assert.False(b.GetProperty("disabled").GetBoolean());

        foreach (var secret in new[] { bob.Creds.SaltB64, bob.Creds.PublicKey, bob.Creds.WrappedPrivateKey, bob.Creds.WrappedContainerKey, "$pbkdf2", "authhash" })
            Assert.DoesNotContain(secret, text, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Disabling_a_user_blocks_login_and_refresh_and_enable_restores_login_only()
    {
        var h = await NewHost();
        var bob = await NewUser(h, "bob");

        var disable = await Send(h.Http, HttpMethod.Post, $"/api/admin/users/{bob.Id}/disable", h.Admin.AccessToken);
        Assert.Equal(HttpStatusCode.NoContent, disable.StatusCode);

        Assert.Equal(HttpStatusCode.Forbidden, (await Login(h.Http, bob.Creds)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Refresh(h.Http, bob.RefreshToken)).StatusCode);

        var users = await Json(await Send(h.Http, HttpMethod.Get, "/api/admin/users", h.Admin.AccessToken));
        Assert.True(users.EnumerateArray().Single(u => Str(u, "id") == bob.Id).GetProperty("disabled").GetBoolean());

        var enable = await Send(h.Http, HttpMethod.Post, $"/api/admin/users/{bob.Id}/enable", h.Admin.AccessToken);
        Assert.Equal(HttpStatusCode.NoContent, enable.StatusCode);

        Assert.Equal(HttpStatusCode.OK, (await Login(h.Http, bob.Creds)).StatusCode);
        // Enabling does not resurrect the sessions revoked by disabling.
        Assert.Equal(HttpStatusCode.Unauthorized, (await Refresh(h.Http, bob.RefreshToken)).StatusCode);
    }

    [Fact]
    public async Task Disabling_is_idempotent()
    {
        var h = await NewHost();
        var bob = await NewUser(h);
        for (var i = 0; i < 2; i++)
            Assert.Equal(HttpStatusCode.NoContent,
                (await Send(h.Http, HttpMethod.Post, $"/api/admin/users/{bob.Id}/disable", h.Admin.AccessToken)).StatusCode);
    }

    [Fact]
    public async Task Admin_cannot_disable_themselves()
    {
        var h = await NewHost();
        var res = await Send(h.Http, HttpMethod.Post, $"/api/admin/users/{h.Admin.Id}/disable", h.Admin.AccessToken);
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);

        // Still fully usable, also when the id is written in another valid GUID format.
        var upper = h.Admin.Id.ToUpperInvariant();
        Assert.Equal(HttpStatusCode.BadRequest,
            (await Send(h.Http, HttpMethod.Post, $"/api/admin/users/{upper}/disable", h.Admin.AccessToken)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Send(h.Http, HttpMethod.Get, "/api/admin/users", h.Admin.AccessToken)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Login(h.Http, h.Admin.Creds)).StatusCode);
    }

    [Theory]
    [InlineData("disable")]
    [InlineData("enable")]
    public async Task Unknown_or_malformed_user_ids_are_404(string action)
    {
        var h = await NewHost();
        foreach (var id in new[] { "0123456789abcdef0123456789abcdef", "not-a-guid", "%27%20OR%201=1--", "12345" })
        {
            var res = await Send(h.Http, HttpMethod.Post, $"/api/admin/users/{id}/{action}", h.Admin.AccessToken);
            Assert.Equal(HttpStatusCode.NotFound, res.StatusCode);
        }
    }

    [Fact]
    public async Task Admin_endpoints_are_not_cacheable()
    {
        var h = await NewHost();
        var res = await Send(h.Http, HttpMethod.Get, "/api/admin/users", h.Admin.AccessToken);
        Assert.Contains("no-store", res.Headers.CacheControl?.ToString() ?? "");
    }
}
