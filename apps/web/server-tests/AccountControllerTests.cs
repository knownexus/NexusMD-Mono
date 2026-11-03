using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using NexusMDWeb.Api.Data;
using NexusMDWeb.Tests.Infrastructure;
using Xunit;

namespace NexusMDWeb.Tests;

/// <summary>HTTP-level tests for /api/account (setup, redeem, login, refresh, logout, change-password).</summary>
public sealed class AccountControllerTests : IDisposable
{
    private const string SetupToken = "test-setup-token";

    private readonly List<TestFactory> _factories = new();

    public void Dispose()
    {
        foreach (var f in _factories) f.Dispose();
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
    }

    private (TestFactory factory, HttpClient client) NewHost(Action<TestFactory>? configure = null)
    {
        var f = new TestFactory();
        _factories.Add(f);
        configure?.Invoke(f);
        return (f, f.CreateClient());
    }

    // ---- helpers -----------------------------------------------------------------------

    private sealed record Creds(string Username, byte[] AuthKey, byte[] Salt, int Iterations,
                                string PublicKey, string WrappedPrivateKey, string WrappedContainerKey)
    {
        public string AuthKeyB64 => Convert.ToBase64String(AuthKey);
        public string SaltB64 => Convert.ToBase64String(Salt);
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

    private static Task<HttpResponseMessage> Setup(HttpClient http, Creds c, string token = SetupToken) =>
        http.PostAsJsonAsync("/api/account/setup", CreateBody(c, setupToken: token));

    private static Task<HttpResponseMessage> Redeem(HttpClient http, Creds c, string code) =>
        http.PostAsJsonAsync("/api/account/redeem", CreateBody(c, inviteCode: code));

    private static Task<HttpResponseMessage> Login(HttpClient http, string username, byte[] authKey) =>
        http.PostAsJsonAsync("/api/account/login", new { username, authKey = Convert.ToBase64String(authKey) });

    private static Task<HttpResponseMessage> Authed(HttpClient http, HttpMethod method, string url, string accessToken, object? body = null)
    {
        var req = new HttpRequestMessage(method, url);
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        if (body != null) req.Content = JsonContent.Create(body);
        return http.SendAsync(req);
    }

    private static async Task<JsonElement> Json(HttpResponseMessage res)
    {
        var text = await res.Content.ReadAsStringAsync();
        return JsonDocument.Parse(text).RootElement.Clone();
    }

    private static async Task<JsonElement> ExpectSession(HttpResponseMessage res, HttpStatusCode status)
    {
        Assert.Equal(status, res.StatusCode);
        var j = await Json(res);
        foreach (var f in new[] { "accessToken", "refreshToken", "expiresIn", "user", "salt", "iterations", "publicKey", "wrappedPrivateKey", "wrappedContainerKey" })
            Assert.True(j.TryGetProperty(f, out _), $"session is missing '{f}'");
        return j;
    }

    private static string Str(JsonElement j, string name) => j.GetProperty(name).GetString()!;

    /// <summary>Creates the first (admin) account and returns its credentials and session.</summary>
    private static async Task<(Creds creds, JsonElement session)> SetupAdmin(HttpClient http)
    {
        var c = NewCreds("admin");
        var s = await ExpectSession(await Setup(http, c), HttpStatusCode.Created);
        return (c, s);
    }

    private static string NewInvite(TestFactory f, string createdBy)
    {
        var repo = f.Services.GetRequiredService<AccountRepository>();
        return repo.CreateInvite(createdBy, TimeSpan.FromHours(1)).code;
    }

    // ---- status / setup ----------------------------------------------------------------

    [Fact]
    public async Task Status_flips_after_setup()
    {
        var (_, http) = NewHost();
        var before = await Json(await http.GetAsync("/api/account/status"));
        Assert.True(before.GetProperty("needsSetup").GetBoolean());

        await SetupAdmin(http);

        var after = await Json(await http.GetAsync("/api/account/status"));
        Assert.False(after.GetProperty("needsSetup").GetBoolean());
    }

    [Fact]
    public async Task Setup_creates_admin_with_token_and_stores_exactly_what_was_sent()
    {
        var (f, http) = NewHost();
        var c = NewCreds("Admin");

        var res = await Setup(http, c);
        var s = await ExpectSession(res, HttpStatusCode.Created);

        Assert.Equal("admin", s.GetProperty("user").GetProperty("role").GetString());
        Assert.Equal("Admin", s.GetProperty("user").GetProperty("username").GetString());
        Assert.False(string.IsNullOrEmpty(Str(s, "accessToken")));
        Assert.False(string.IsNullOrEmpty(Str(s, "refreshToken")));

        var u = f.Services.GetRequiredService<AccountRepository>().FindByUsername("admin")!;
        Assert.Equal("admin", u.Role);
        Assert.Equal(c.SaltB64, u.Salt);
        Assert.Equal(c.Iterations, u.Iterations);
        Assert.Equal(c.PublicKey, u.PublicKey);
        Assert.Equal(c.WrappedPrivateKey, u.WrappedPrivateKey);
        Assert.Equal(c.WrappedContainerKey, u.WrappedContainerKey);
        // The stored hash is derived server-side: never the auth key itself.
        Assert.DoesNotContain(c.AuthKeyB64, u.AuthHash);
        Assert.NotEqual(c.AuthKeyB64, u.AuthHash);
    }

    [Fact]
    public async Task Setup_with_wrong_token_is_403_and_creates_nothing()
    {
        var (f, http) = NewHost();

        var res = await Setup(http, NewCreds(), "nope");

        Assert.Equal(HttpStatusCode.Forbidden, res.StatusCode);
        Assert.False(f.Services.GetRequiredService<AccountRepository>().AnyUser());
    }

    [Fact]
    public async Task Setup_is_disabled_when_no_setup_token_is_configured()
    {
        var (f, http) = NewHost(f => f.Overrides["Accounts:SetupToken"] = "");

        // An empty submitted token must not match an empty configured token.
        var res = await Setup(http, NewCreds(), "");
        var res2 = await Setup(http, NewCreds(), "anything");

        Assert.Equal(HttpStatusCode.Forbidden, res.StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, res2.StatusCode);
        Assert.False(f.Services.GetRequiredService<AccountRepository>().AnyUser());
    }

    [Fact]
    public async Task Whitespace_only_setup_token_counts_as_unset()
    {
        var (f, http) = NewHost(f => f.Overrides["Accounts:SetupToken"] = "   ");

        var res = await Setup(http, NewCreds(), "   ");

        Assert.Equal(HttpStatusCode.Forbidden, res.StatusCode);
        Assert.False(f.Services.GetRequiredService<AccountRepository>().AnyUser());
    }

    [Fact]
    public void Account_actions_fail_closed_only_the_six_anonymous_ones_are_open()
    {
        var t = typeof(NexusMDWeb.Api.Controllers.AccountController);
        Assert.NotEmpty(t.GetCustomAttributes(typeof(Microsoft.AspNetCore.Authorization.AuthorizeAttribute), inherit: true));
        var anonymous = t.GetMethods(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.DeclaredOnly)
            .Where(m => m.GetCustomAttributes(typeof(Microsoft.AspNetCore.Authorization.AllowAnonymousAttribute), false).Length > 0)
            .Select(m => m.Name).OrderBy(n => n).ToArray();
        Assert.Equal(new[] { "Login", "Params", "Redeem", "Refresh", "Setup", "Status" }, anonymous);
    }

    [Fact]
    public async Task Setup_a_second_time_is_409()
    {
        var (_, http) = NewHost();
        await SetupAdmin(http);

        var res = await Setup(http, NewCreds());

        Assert.Equal(HttpStatusCode.Conflict, res.StatusCode);
    }

    [Fact]
    public async Task Concurrent_setup_calls_yield_exactly_one_201()
    {
        var (f, http) = NewHost();
        var calls = Enumerable.Range(0, 8).Select(i => Task.Run(() => Setup(http, NewCreds("admin" + i)))).ToArray();

        var results = await Task.WhenAll(calls);

        Assert.Single(results, r => r.StatusCode == HttpStatusCode.Created);
        Assert.Equal(7, results.Count(r => r.StatusCode == HttpStatusCode.Conflict));
        Assert.Single(f.Services.GetRequiredService<AccountRepository>().ListUsers());
    }

    // ---- validation --------------------------------------------------------------------

    [Fact]
    public async Task Malformed_unicode_username_is_400_not_500()
    {
        var (_, http) = NewHost();
        var c = NewCreds();
        // A lone high surrogate, sent as a JSON escape.
        var json = $$"""
            {"username":"ab\ud800cd","salt":"{{c.SaltB64}}","iterations":600000,"authKey":"{{c.AuthKeyB64}}",
             "publicKey":"{{c.PublicKey}}","wrappedPrivateKey":"{{c.WrappedPrivateKey}}","wrappedContainerKey":"{{c.WrappedContainerKey}}",
             "setupToken":"{{SetupToken}}"}
            """;

        var res = await http.PostAsync("/api/account/setup", new StringContent(json, Encoding.UTF8, "application/json"));

        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);

        var login = await http.PostAsync("/api/account/login",
            new StringContent($$"""{"username":"ab\ud800cd","authKey":"{{c.AuthKeyB64}}"}""", Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.BadRequest, login.StatusCode);

        // Invalid UTF-8 in a query string reaches the controller as U+FFFD, which is rejected.
        var p = await http.GetAsync("/api/account/params?username=ab%EF%BF%BDcd");
        Assert.Equal(HttpStatusCode.BadRequest, p.StatusCode);
    }

    [Theory]
    [InlineData("ab")]                       // too short
    [InlineData("  ab  ")]                   // too short after trim
    [InlineData("has\u0007bell")]            // control character
    [InlineData("line\nbreak")]              // control character
    [InlineData("ab​cd")]               // zero-width space (Cf)
    [InlineData("ab‮cd")]               // right-to-left override (Cf)
    [InlineData("ab cd")]               // non-breaking space inside
    [InlineData("ab　cd")]               // ideographic space inside
    [InlineData("abㅤcd")]               // hangul filler (invisible letter)
    [InlineData("abcd")]               // private use
    public async Task Bad_usernames_are_400(string username)
    {
        var (_, http) = NewHost();

        var res = await Setup(http, NewCreds(username));

        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task Username_over_64_chars_is_400_and_exactly_64_is_ok()
    {
        var (_, http) = NewHost();

        Assert.Equal(HttpStatusCode.BadRequest, (await Setup(http, NewCreds(new string('a', 65)))).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await Setup(http, NewCreds(new string('a', 64)))).StatusCode);
    }

    [Fact]
    public async Task Field_validation_rejects_bad_salt_iterations_authkey_and_base64()
    {
        var (f, http) = NewHost();
        var good = NewCreds("validuser");

        async Task<HttpStatusCode> Post(Func<Dictionary<string, object?>, Dictionary<string, object?>> mutate)
        {
            var d = new Dictionary<string, object?>
            {
                ["username"] = good.Username, ["salt"] = good.SaltB64, ["iterations"] = good.Iterations,
                ["authKey"] = good.AuthKeyB64, ["publicKey"] = good.PublicKey,
                ["wrappedPrivateKey"] = good.WrappedPrivateKey, ["wrappedContainerKey"] = good.WrappedContainerKey,
                ["setupToken"] = SetupToken,
            };
            return (await http.PostAsJsonAsync("/api/account/setup", mutate(d))).StatusCode;
        }

        Assert.Equal(HttpStatusCode.BadRequest, await Post(d => { d["salt"] = RandB64(15); return d; }));
        Assert.Equal(HttpStatusCode.BadRequest, await Post(d => { d["salt"] = RandB64(17); return d; }));
        Assert.Equal(HttpStatusCode.BadRequest, await Post(d => { d["salt"] = "not base64!!"; return d; }));
        Assert.Equal(HttpStatusCode.BadRequest, await Post(d => { d["iterations"] = 999; return d; }));
        Assert.Equal(HttpStatusCode.BadRequest, await Post(d => { d["iterations"] = 10_000_001; return d; }));
        Assert.Equal(HttpStatusCode.BadRequest, await Post(d => { d["authKey"] = RandB64(31); return d; }));
        Assert.Equal(HttpStatusCode.BadRequest, await Post(d => { d["authKey"] = "%%%"; return d; }));
        Assert.Equal(HttpStatusCode.BadRequest, await Post(d => { d["publicKey"] = ""; return d; }));
        Assert.Equal(HttpStatusCode.BadRequest, await Post(d => { d["wrappedPrivateKey"] = "***"; return d; }));
        Assert.Equal(HttpStatusCode.BadRequest, await Post(d => { d["wrappedContainerKey"] = null; return d; }));
        Assert.Equal(HttpStatusCode.BadRequest, await Post(d => { d["wrappedContainerKey"] = new string('A', 20000); return d; }));
        Assert.False(f.Services.GetRequiredService<AccountRepository>().AnyUser());

        // Boundary values are accepted.
        Assert.Equal(HttpStatusCode.Created, await Post(d => { d["iterations"] = 1000; return d; }));
    }

    [Fact]
    public async Task Unparseable_or_empty_body_is_400()
    {
        var (_, http) = NewHost();

        var bad = await http.PostAsync("/api/account/setup", new StringContent("{not json", Encoding.UTF8, "application/json"));
        var empty = await http.PostAsync("/api/account/login", new StringContent("null", Encoding.UTF8, "application/json"));

        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, empty.StatusCode);
    }

    // ---- params ------------------------------------------------------------------------

    [Fact]
    public async Task Params_returns_real_salt_for_known_user_and_stable_fake_for_unknown()
    {
        var (_, http) = NewHost();
        var (admin, _) = await SetupAdmin(http);

        var known = await Json(await http.GetAsync("/api/account/params?username=ADMIN"));
        Assert.Equal(admin.SaltB64, Str(known, "salt"));
        Assert.Equal(admin.Iterations, known.GetProperty("iterations").GetInt32());

        var a = await Json(await http.GetAsync("/api/account/params?username=ghost"));
        var b = await Json(await http.GetAsync("/api/account/params?username=GHOST"));
        var other = await Json(await http.GetAsync("/api/account/params?username=phantom"));
        Assert.Equal(Str(a, "salt"), Str(b, "salt"));
        Assert.NotEqual(Str(a, "salt"), Str(other, "salt"));
        Assert.Equal(600000, a.GetProperty("iterations").GetInt32());
        Assert.Equal(16, Convert.FromBase64String(Str(a, "salt")).Length);
    }

    [Fact]
    public async Task Params_fake_salt_is_stable_across_restarts_with_the_same_signing_key()
    {
        var (_, http1) = NewHost();
        var (_, http2) = NewHost();

        var a = await Json(await http1.GetAsync("/api/account/params?username=ghost"));
        var b = await Json(await http2.GetAsync("/api/account/params?username=ghost"));

        Assert.Equal(Str(a, "salt"), Str(b, "salt"));
    }

    [Fact]
    public async Task Params_requires_a_valid_username()
    {
        var (_, http) = NewHost();

        Assert.Equal(HttpStatusCode.BadRequest, (await http.GetAsync("/api/account/params")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await http.GetAsync("/api/account/params?username=a")).StatusCode);
    }

    // ---- login -------------------------------------------------------------------------

    [Fact]
    public async Task Login_succeeds_with_correct_key_and_returns_the_stored_blobs()
    {
        var (_, http) = NewHost();
        var (admin, _) = await SetupAdmin(http);

        var s = await ExpectSession(await Login(http, "Admin", admin.AuthKey), HttpStatusCode.OK);

        Assert.Equal(admin.SaltB64, Str(s, "salt"));
        Assert.Equal(admin.Iterations, s.GetProperty("iterations").GetInt32());
        Assert.Equal(admin.PublicKey, Str(s, "publicKey"));
        Assert.Equal(admin.WrappedPrivateKey, Str(s, "wrappedPrivateKey"));
        Assert.Equal(admin.WrappedContainerKey, Str(s, "wrappedContainerKey"));
        Assert.True(s.GetProperty("expiresIn").GetInt32() > 0);
    }

    [Fact]
    public async Task Login_unknown_user_and_wrong_key_produce_byte_identical_401()
    {
        var (_, http) = NewHost();
        var (admin, _) = await SetupAdmin(http);

        var unknown = await Login(http, "nobody-here", RandomNumberGenerator.GetBytes(32));
        var wrong = await Login(http, admin.Username, RandomNumberGenerator.GetBytes(32));

        Assert.Equal(HttpStatusCode.Unauthorized, unknown.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, wrong.StatusCode);
        Assert.Equal(await unknown.Content.ReadAsByteArrayAsync(), await wrong.Content.ReadAsByteArrayAsync());
        Assert.Equal(unknown.Content.Headers.ContentType?.ToString(), wrong.Content.Headers.ContentType?.ToString());
    }

    [Fact]
    public async Task Five_bad_logins_lock_the_account_and_a_correct_key_is_still_423()
    {
        var (f, http) = NewHost();
        var (admin, _) = await SetupAdmin(http);

        for (var i = 0; i < 4; i++)
            Assert.Equal(HttpStatusCode.Unauthorized, (await Login(http, admin.Username, RandomNumberGenerator.GetBytes(32))).StatusCode);
        Assert.Equal((HttpStatusCode)423, (await Login(http, admin.Username, RandomNumberGenerator.GetBytes(32))).StatusCode);

        // Correct key while locked: still 423, and it must not unlock or touch the counter.
        var locked = await Login(http, admin.Username, admin.AuthKey);
        Assert.Equal((HttpStatusCode)423, locked.StatusCode);
        Assert.True(locked.Headers.Contains("Retry-After"));
        var repo = f.Services.GetRequiredService<AccountRepository>();
        Assert.Equal(AccountRepository.MaxFailedLogins, repo.FindByUsername("admin")!.FailedLogins);

        // Wrong key while locked: 423, and no failure is recorded or lock extended.
        var before = repo.FindByUsername("admin")!.LockedUntil;
        Assert.Equal((HttpStatusCode)423, (await Login(http, admin.Username, RandomNumberGenerator.GetBytes(32))).StatusCode);
        var after = repo.FindByUsername("admin")!;
        Assert.Equal(before, after.LockedUntil);
        Assert.Equal(AccountRepository.MaxFailedLogins, after.FailedLogins);
    }

    [Fact]
    public async Task Successful_login_resets_the_failure_counter()
    {
        var (f, http) = NewHost();
        var (admin, _) = await SetupAdmin(http);
        for (var i = 0; i < 3; i++) await Login(http, admin.Username, RandomNumberGenerator.GetBytes(32));

        await ExpectSession(await Login(http, admin.Username, admin.AuthKey), HttpStatusCode.OK);

        Assert.Equal(0, f.Services.GetRequiredService<AccountRepository>().FindByUsername("admin")!.FailedLogins);
    }

    [Fact]
    public async Task Login_for_a_disabled_user_is_403_and_their_refresh_token_is_dead()
    {
        var (f, http) = NewHost();
        var (admin, setupSession) = await SetupAdmin(http);
        var invite = NewInvite(f, setupSession.GetProperty("user").GetProperty("id").GetString()!);
        var bob = NewCreds("bob");
        var bobSession = await ExpectSession(await Redeem(http, bob, invite), HttpStatusCode.Created);
        var repo = f.Services.GetRequiredService<AccountRepository>();

        repo.SetDisabled(Str(bobSession.GetProperty("user"), "id"), true);

        Assert.Equal(HttpStatusCode.Forbidden, (await Login(http, "bob", bob.AuthKey)).StatusCode);
        var refresh = await http.PostAsJsonAsync("/api/account/refresh", new { refreshToken = Str(bobSession, "refreshToken") });
        Assert.Equal(HttpStatusCode.Unauthorized, refresh.StatusCode);
        // Wrong key for a disabled user must not reveal the disabled state.
        Assert.Equal(HttpStatusCode.Unauthorized, (await Login(http, "bob", RandomNumberGenerator.GetBytes(32))).StatusCode);
        _ = admin;
    }

    [Fact]
    public async Task Login_with_malformed_authkey_is_400()
    {
        var (_, http) = NewHost();
        await SetupAdmin(http);

        var res = await http.PostAsJsonAsync("/api/account/login", new { username = "admin", authKey = "short" });

        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    // ---- refresh / logout --------------------------------------------------------------

    [Fact]
    public async Task Refresh_rotates_and_replaying_the_old_token_revokes_the_session()
    {
        var (_, http) = NewHost();
        var (_, setup) = await SetupAdmin(http);
        var first = Str(setup, "refreshToken");

        var rotated = await ExpectSession(
            await http.PostAsJsonAsync("/api/account/refresh", new { refreshToken = first }), HttpStatusCode.OK);
        var second = Str(rotated, "refreshToken");
        Assert.NotEqual(first, second);
        Assert.Equal("admin", rotated.GetProperty("user").GetProperty("role").GetString());

        var replay = await http.PostAsJsonAsync("/api/account/refresh", new { refreshToken = first });
        Assert.Equal(HttpStatusCode.Unauthorized, replay.StatusCode);

        // Reuse detection killed the whole session, so the newest token is dead too.
        var newest = await http.PostAsJsonAsync("/api/account/refresh", new { refreshToken = second });
        Assert.Equal(HttpStatusCode.Unauthorized, newest.StatusCode);
    }

    [Fact]
    public async Task Refresh_with_unknown_or_missing_token_is_401_or_400()
    {
        var (_, http) = NewHost();
        await SetupAdmin(http);

        Assert.Equal(HttpStatusCode.Unauthorized,
            (await http.PostAsJsonAsync("/api/account/refresh", new { refreshToken = "bogus" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await http.PostAsJsonAsync("/api/account/refresh", new { refreshToken = "" })).StatusCode);
    }

    [Fact]
    public async Task Refreshed_access_token_is_usable()
    {
        var (_, http) = NewHost();
        var (_, setup) = await SetupAdmin(http);
        var rotated = await ExpectSession(
            await http.PostAsJsonAsync("/api/account/refresh", new { refreshToken = Str(setup, "refreshToken") }), HttpStatusCode.OK);

        // logout is authenticated: a 204 proves the new access token is accepted.
        var res = await Authed(http, HttpMethod.Post, "/api/account/logout", Str(rotated, "accessToken"),
            new { refreshToken = Str(rotated, "refreshToken") });

        Assert.Equal(HttpStatusCode.NoContent, res.StatusCode);
    }

    [Fact]
    public async Task Logout_requires_auth_returns_204_and_kills_the_refresh_token()
    {
        var (_, http) = NewHost();
        var (_, setup) = await SetupAdmin(http);
        var refresh = Str(setup, "refreshToken");

        var anon = await http.PostAsJsonAsync("/api/account/logout", new { refreshToken = refresh });
        Assert.Equal(HttpStatusCode.Unauthorized, anon.StatusCode);

        var res = await Authed(http, HttpMethod.Post, "/api/account/logout", Str(setup, "accessToken"), new { refreshToken = refresh });
        Assert.Equal(HttpStatusCode.NoContent, res.StatusCode);

        var after = await http.PostAsJsonAsync("/api/account/refresh", new { refreshToken = refresh });
        Assert.Equal(HttpStatusCode.Unauthorized, after.StatusCode);
    }

    [Fact]
    public async Task Logout_cannot_revoke_another_users_session()
    {
        var (f, http) = NewHost();
        var (_, setup) = await SetupAdmin(http);
        var adminId = setup.GetProperty("user").GetProperty("id").GetString()!;
        var bobSession = await ExpectSession(await Redeem(http, NewCreds("bob"), NewInvite(f, adminId)), HttpStatusCode.Created);

        var res = await Authed(http, HttpMethod.Post, "/api/account/logout", Str(setup, "accessToken"),
            new { refreshToken = Str(bobSession, "refreshToken") });

        Assert.Equal(HttpStatusCode.NoContent, res.StatusCode);
        var stillAlive = await http.PostAsJsonAsync("/api/account/refresh", new { refreshToken = Str(bobSession, "refreshToken") });
        Assert.Equal(HttpStatusCode.OK, stillAlive.StatusCode);
    }

    // ---- redeem ------------------------------------------------------------------------

    [Fact]
    public async Task Redeem_creates_a_user_role_and_consumes_the_invite()
    {
        var (f, http) = NewHost();
        var (_, setup) = await SetupAdmin(http);
        var invite = NewInvite(f, setup.GetProperty("user").GetProperty("id").GetString()!);
        var bob = NewCreds("bob");

        var s = await ExpectSession(await Redeem(http, bob, invite), HttpStatusCode.Created);

        Assert.Equal("user", s.GetProperty("user").GetProperty("role").GetString());
        var stored = f.Services.GetRequiredService<AccountRepository>().FindByUsername("bob")!;
        Assert.Equal(bob.PublicKey, stored.PublicKey);
        Assert.Equal(bob.WrappedPrivateKey, stored.WrappedPrivateKey);
        Assert.Equal(bob.WrappedContainerKey, stored.WrappedContainerKey);

        // The invite is single-use.
        var again = await Redeem(http, NewCreds("carol"), invite);
        Assert.Equal(HttpStatusCode.BadRequest, again.StatusCode);
    }

    [Fact]
    public async Task Redeem_with_unknown_expired_or_missing_invite_is_400()
    {
        var (f, http) = NewHost();
        var (_, setup) = await SetupAdmin(http);
        var repo = f.Services.GetRequiredService<AccountRepository>();
        var expired = repo.CreateInvite(setup.GetProperty("user").GetProperty("id").GetString()!, TimeSpan.FromSeconds(-5)).code;

        Assert.Equal(HttpStatusCode.BadRequest, (await Redeem(http, NewCreds(), "NOTACODE")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Redeem(http, NewCreds(), expired)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Redeem(http, NewCreds(), "")).StatusCode);
    }

    [Fact]
    public async Task Redeem_with_a_taken_username_is_409_and_leaves_the_invite_usable()
    {
        var (f, http) = NewHost();
        var (_, setup) = await SetupAdmin(http);
        var invite = NewInvite(f, setup.GetProperty("user").GetProperty("id").GetString()!);

        var clash = await Redeem(http, NewCreds("ADMIN"), invite);
        Assert.Equal(HttpStatusCode.Conflict, clash.StatusCode);

        var ok = await Redeem(http, NewCreds("fresh-name"), invite);
        Assert.Equal(HttpStatusCode.Created, ok.StatusCode);
    }

    // ---- change-password ---------------------------------------------------------------

    private static object ChangeBody(byte[] currentAuthKey, Creds next) => new
    {
        currentAuthKey = Convert.ToBase64String(currentAuthKey),
        salt = next.SaltB64,
        iterations = next.Iterations,
        authKey = next.AuthKeyB64,
        wrappedPrivateKey = next.WrappedPrivateKey,
        wrappedContainerKey = next.WrappedContainerKey,
    };

    [Fact]
    public async Task Change_password_returns_a_usable_new_session_and_kills_every_old_session()
    {
        var (_, http) = NewHost();
        var (admin, setup) = await SetupAdmin(http);
        var secondLogin = await ExpectSession(await Login(http, admin.Username, admin.AuthKey), HttpStatusCode.OK);
        var next = NewCreds("admin");

        var res = await Authed(http, HttpMethod.Post, "/api/account/change-password", Str(setup, "accessToken"),
            ChangeBody(admin.AuthKey, next));
        var fresh = await ExpectSession(res, HttpStatusCode.OK);

        // New credentials are echoed back.
        Assert.Equal(next.SaltB64, Str(fresh, "salt"));
        Assert.Equal(next.WrappedPrivateKey, Str(fresh, "wrappedPrivateKey"));
        Assert.Equal(next.WrappedContainerKey, Str(fresh, "wrappedContainerKey"));
        Assert.Equal(admin.PublicKey, Str(fresh, "publicKey"));

        // Both old sessions (the caller's and the other device's) are revoked.
        Assert.Equal(HttpStatusCode.Unauthorized,
            (await http.PostAsJsonAsync("/api/account/refresh", new { refreshToken = Str(setup, "refreshToken") })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized,
            (await http.PostAsJsonAsync("/api/account/refresh", new { refreshToken = Str(secondLogin, "refreshToken") })).StatusCode);

        // The new session works, and so do the new credentials; the old auth key is dead.
        var refreshed = await http.PostAsJsonAsync("/api/account/refresh", new { refreshToken = Str(fresh, "refreshToken") });
        Assert.Equal(HttpStatusCode.OK, refreshed.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Login(http, admin.Username, admin.AuthKey)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Login(http, admin.Username, next.AuthKey)).StatusCode);
        var again = await Authed(http, HttpMethod.Post, "/api/account/change-password", Str(fresh, "accessToken"),
            ChangeBody(next.AuthKey, admin));
        Assert.Equal(HttpStatusCode.OK, again.StatusCode);
    }

    [Fact]
    public async Task Change_password_with_wrong_current_key_is_401_changes_nothing_and_counts_toward_lockout()
    {
        var (f, http) = NewHost();
        var (admin, setup) = await SetupAdmin(http);
        var next = NewCreds("admin");

        HttpStatusCode last = default;
        for (var i = 0; i < 5; i++)
        {
            var res = await Authed(http, HttpMethod.Post, "/api/account/change-password", Str(setup, "accessToken"),
                ChangeBody(RandomNumberGenerator.GetBytes(32), next));
            last = res.StatusCode;
            if (i < 4) Assert.Equal(HttpStatusCode.Unauthorized, last);
        }

        // 5th failure locks the account (same policy as login).
        Assert.Equal((HttpStatusCode)423, last);
        Assert.Equal((HttpStatusCode)423, (await Login(http, admin.Username, admin.AuthKey)).StatusCode);
        var stored = f.Services.GetRequiredService<AccountRepository>().FindByUsername("admin")!;
        Assert.Equal(admin.SaltB64, stored.Salt);
        Assert.Equal(admin.WrappedPrivateKey, stored.WrappedPrivateKey);
        // Even the correct current key is refused while locked.
        var locked = await Authed(http, HttpMethod.Post, "/api/account/change-password", Str(setup, "accessToken"),
            ChangeBody(admin.AuthKey, next));
        Assert.Equal((HttpStatusCode)423, locked.StatusCode);
        // The existing session is untouched.
        Assert.Equal(HttpStatusCode.OK,
            (await http.PostAsJsonAsync("/api/account/refresh", new { refreshToken = Str(setup, "refreshToken") })).StatusCode);
    }

    [Fact]
    public async Task Change_password_requires_auth_and_valid_fields()
    {
        var (_, http) = NewHost();
        var (admin, setup) = await SetupAdmin(http);
        var next = NewCreds("admin");

        var anon = await http.PostAsJsonAsync("/api/account/change-password", ChangeBody(admin.AuthKey, next));
        Assert.Equal(HttpStatusCode.Unauthorized, anon.StatusCode);

        var bad = await Authed(http, HttpMethod.Post, "/api/account/change-password", Str(setup, "accessToken"),
            new { currentAuthKey = admin.AuthKeyB64, salt = RandB64(8), iterations = 600000, authKey = next.AuthKeyB64,
                  wrappedPrivateKey = next.WrappedPrivateKey, wrappedContainerKey = next.WrappedContainerKey });
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
    }

    // ---- no key material crosses the wire ----------------------------------------------

    [Fact]
    public async Task Responses_never_contain_vault_key_or_plaintext_fields_or_the_auth_key()
    {
        var (f, http) = NewHost();
        var c = NewCreds("admin");

        var setup = await Setup(http, c);
        var setupText = await setup.Content.ReadAsStringAsync();
        var login = await Login(http, c.Username, c.AuthKey);
        var loginText = await login.Content.ReadAsStringAsync();
        var invite = NewInvite(f, JsonDocument.Parse(setupText).RootElement.GetProperty("user").GetProperty("id").GetString()!);
        var bob = NewCreds("bob");
        var redeemText = await (await Redeem(http, bob, invite)).Content.ReadAsStringAsync();

        foreach (var text in new[] { setupText, loginText, redeemText })
        {
            var names = JsonDocument.Parse(text).RootElement.EnumerateObject().Select(p => p.Name).ToHashSet();
            Assert.DoesNotContain("vaultKey", names);
            Assert.DoesNotContain("containerKey", names);
            Assert.DoesNotContain("password", names);
            Assert.DoesNotContain("authKey", names);
            Assert.DoesNotContain("authHash", names);
            Assert.DoesNotContain(c.AuthKeyB64, text);
            Assert.DoesNotContain(bob.AuthKeyB64, text);
        }

        // The request schema has no field that could carry a vault key: only the opaque blobs are stored.
        var stored = f.Services.GetRequiredService<AccountRepository>().FindByUsername("bob")!;
        Assert.Equal(bob.WrappedContainerKey, stored.WrappedContainerKey);
        Assert.Equal(bob.WrappedPrivateKey, stored.WrappedPrivateKey);
        Assert.Equal(bob.PublicKey, stored.PublicKey);
        Assert.Equal(bob.SaltB64, stored.Salt);
    }

    // ---- fix round 1 -------------------------------------------------------------------

    private static long Scalar(TestFactory f, string sql, params (string, object)[] args)
    {
        using var conn = new Microsoft.Data.Sqlite.SqliteConnection($"Data Source={Path.Combine(f.ContentRoot, "accounts.db")}");
        conn.Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (k, v) in args) cmd.Parameters.AddWithValue(k, v);
        var scalar = cmd.ExecuteScalar();
        return scalar is null or DBNull ? 0 : Convert.ToInt64(scalar);
    }

    private static void Exec(TestFactory f, string sql, params (string, object)[] args)
    {
        using var conn = new Microsoft.Data.Sqlite.SqliteConnection($"Data Source={Path.Combine(f.ContentRoot, "accounts.db")}");
        conn.Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (k, v) in args) cmd.Parameters.AddWithValue(k, v);
        cmd.ExecuteNonQuery();
    }

    [Fact]
    public async Task Concurrent_wrong_key_logins_are_capped_at_five_verifications_and_the_rest_are_423()
    {
        var (f, http) = NewHost();
        var (admin, _) = await SetupAdmin(http);

        var calls = Enumerable.Range(0, 12)
            .Select(_ => Task.Run(() => Login(http, admin.Username, RandomNumberGenerator.GetBytes(32)))).ToArray();
        var results = await Task.WhenAll(calls);

        var unauthorized = results.Count(r => r.StatusCode == HttpStatusCode.Unauthorized);
        var locked = results.Count(r => r.StatusCode == (HttpStatusCode)423);
        // On any mismatch show every response (status + body) so an intermittent 5xx can be diagnosed.
        string Dump() => string.Join(" | ", results.Select(r =>
            $"{(int)r.StatusCode}:{r.Content.ReadAsStringAsync().GetAwaiter().GetResult()}"));
        Assert.True(unauthorized <= 5, $"{unauthorized} attempts were verified: {Dump()}");
        Assert.True(12 == unauthorized + locked, $"expected 12 x 401/423 but got {unauthorized} x 401 and {locked} x 423: {Dump()}");
        Assert.True(locked >= 7, $"only {locked} x 423: {Dump()}");
        var u = f.Services.GetRequiredService<AccountRepository>().FindByUsername("admin")!;
        Assert.Equal(5, u.FailedLogins);
        Assert.NotNull(u.LockedUntil);
        Assert.Equal((HttpStatusCode)423, (await Login(http, admin.Username, admin.AuthKey)).StatusCode);
    }

    [Fact]
    public async Task Change_password_wrong_key_attempts_reserve_atomically_too()
    {
        var (f, http) = NewHost();
        var (admin, setup) = await SetupAdmin(http);
        var next = NewCreds("admin");

        var calls = Enumerable.Range(0, 10).Select(_ => Task.Run(() =>
            Authed(http, HttpMethod.Post, "/api/account/change-password", Str(setup, "accessToken"),
                ChangeBody(RandomNumberGenerator.GetBytes(32), next)))).ToArray();
        var results = await Task.WhenAll(calls);

        Assert.True(results.Count(r => r.StatusCode == HttpStatusCode.Unauthorized) <= 5);
        Assert.Equal(10, results.Count(r => r.StatusCode is HttpStatusCode.Unauthorized or (HttpStatusCode)423));
        Assert.Equal(5, f.Services.GetRequiredService<AccountRepository>().FindByUsername("admin")!.FailedLogins);
        _ = admin;
    }

    [Fact]
    public async Task Successful_change_password_resets_the_failure_counter()
    {
        var (f, http) = NewHost();
        var (admin, setup) = await SetupAdmin(http);
        for (var i = 0; i < 2; i++)
            await Authed(http, HttpMethod.Post, "/api/account/change-password", Str(setup, "accessToken"),
                ChangeBody(RandomNumberGenerator.GetBytes(32), NewCreds("admin")));

        var res = await Authed(http, HttpMethod.Post, "/api/account/change-password", Str(setup, "accessToken"),
            ChangeBody(admin.AuthKey, NewCreds("admin")));

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Equal(0, f.Services.GetRequiredService<AccountRepository>().FindByUsername("admin")!.FailedLogins);
    }

    /// <summary>Repository whose session creation can be interleaved with another request (a test seam).</summary>
    private sealed class RacyRepository(Microsoft.Extensions.Configuration.IConfiguration cfg) : AccountRepository(cfg)
    {
        public Action? BeforeCreateSession;

        public override string? CreateSessionIfCredentialsCurrent(string userId, string refreshHash, string expectedAuthHash)
        {
            var hook = BeforeCreateSession;
            BeforeCreateSession = null;
            hook?.Invoke();
            return base.CreateSessionIfCredentialsCurrent(userId, refreshHash, expectedAuthHash);
        }
    }

    [Fact]
    public async Task Login_racing_a_password_change_never_leaves_a_session_for_the_old_credentials()
    {
        RacyRepository? racy = null;
        using var f = new TestFactory();
        using var derived = f.WithWebHostBuilder(b => b.ConfigureTestServices(services =>
        {
            foreach (var d in services.Where(d => d.ServiceType == typeof(AccountRepository)).ToList()) services.Remove(d);
            services.AddSingleton<AccountRepository>(sp =>
                racy = new RacyRepository(sp.GetRequiredService<Microsoft.Extensions.Configuration.IConfiguration>()));
        }));
        var http = derived.CreateClient();
        var (admin, _) = await SetupAdmin(http);
        var userId = racy!.FindByUsername("admin")!.Id;

        // Between the key being verified and the session being created, the password is changed elsewhere.
        racy.BeforeCreateSession = () => racy.ChangeCredentials(userId, RandB64(16), 600000, "replaced-hash",
            RandB64(100), RandB64(60), "hook-refresh-hash");

        var res = await Login(http, admin.Username, admin.AuthKey);

        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
        // Only the session created together with the new credentials is alive; nothing for the old ones.
        Assert.Equal(1, Scalar(f, "SELECT COUNT(*) FROM Sessions WHERE RevokedAt IS NULL"));
        Assert.Equal(1, Scalar(f, "SELECT COUNT(*) FROM Sessions WHERE RevokedAt IS NULL AND RefreshHash='hook-refresh-hash'"));
        // The failed attempt did not leave the account counting failures against the right key.
        Assert.Equal(0, racy.FindByUsername("admin")!.FailedLogins);
    }

    [Fact]
    public async Task Rate_limit_returns_429_on_the_21st_anonymous_request_and_spares_other_endpoints()
    {
        var (_, http) = NewHost(f => f.Overrides["RateLimit:PermitPerMinute"] = "20");

        for (var i = 0; i < 20; i++)
            Assert.Equal(HttpStatusCode.OK, (await http.GetAsync("/api/account/status")).StatusCode);

        Assert.Equal((HttpStatusCode)429, (await http.GetAsync("/api/account/status")).StatusCode);
        // The limit is shared across the anonymous account endpoints.
        Assert.Equal((HttpStatusCode)429, (await http.GetAsync("/api/account/params?username=someone")).StatusCode);
        Assert.Equal((HttpStatusCode)429, (await Login(http, "someone", RandomNumberGenerator.GetBytes(32))).StatusCode);
        // Unrelated endpoints are not limited.
        Assert.NotEqual((HttpStatusCode)429, (await http.GetAsync("/api/google/auth/url")).StatusCode);
    }

    [Fact]
    public async Task Rate_limit_is_per_client_ip_using_the_forwarded_for_header()
    {
        var (_, http) = NewHost(f =>
        {
            f.Overrides["RateLimit:PermitPerMinute"] = "3";
            f.Overrides["Proxy:TrustForwardedHeaders"] = "true";
        });

        HttpRequestMessage From(string ip)
        {
            var r = new HttpRequestMessage(HttpMethod.Get, "/api/account/status");
            r.Headers.Add("X-Forwarded-For", ip);
            return r;
        }

        for (var i = 0; i < 3; i++) Assert.Equal(HttpStatusCode.OK, (await http.SendAsync(From("203.0.113.7"))).StatusCode);
        Assert.Equal((HttpStatusCode)429, (await http.SendAsync(From("203.0.113.7"))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await http.SendAsync(From("203.0.113.8"))).StatusCode);
    }

    // Railway's edge sends "X-Forwarded-For: <client>, <edge ip>" where the edge ip changes between requests, and
    // "X-Real-IP: <client>" (both are set by the edge; client-supplied values are dropped). Measured 2026-11-03.
    static HttpRequestMessage FromRailway(string client, string edge)
    {
        var r = new HttpRequestMessage(HttpMethod.Get, "/api/account/status");
        r.Headers.Add("X-Forwarded-For", $"{client}, {edge}");
        r.Headers.Add("X-Real-IP", client);
        return r;
    }

    [Fact]
    public async Task Rate_limit_uses_the_configured_client_ip_header_when_the_proxy_edge_ip_varies()
    {
        var (_, http) = NewHost(f =>
        {
            f.Overrides["RateLimit:PermitPerMinute"] = "3";
            f.Overrides["Proxy:TrustForwardedHeaders"] = "true";
            f.Overrides["Proxy:ClientIpHeader"] = "X-Real-IP";
        });

        for (var i = 0; i < 3; i++)
            Assert.Equal(HttpStatusCode.OK, (await http.SendAsync(FromRailway("89.37.68.50", $"152.233.29.{i + 1}"))).StatusCode);
        Assert.Equal((HttpStatusCode)429, (await http.SendAsync(FromRailway("89.37.68.50", "152.233.29.9"))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await http.SendAsync(FromRailway("89.37.68.51", "152.233.29.9"))).StatusCode);
    }

    [Fact]
    public async Task Client_ip_header_is_ignored_unless_forwarded_headers_are_trusted()
    {
        var (_, http) = NewHost(f =>
        {
            f.Overrides["RateLimit:PermitPerMinute"] = "2";
            f.Overrides["Proxy:ClientIpHeader"] = "X-Real-IP"; // Proxy:TrustForwardedHeaders deliberately unset
        });

        Assert.Equal(HttpStatusCode.OK, (await http.SendAsync(FromRailway("203.0.113.1", "152.233.29.1"))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await http.SendAsync(FromRailway("203.0.113.2", "152.233.29.1"))).StatusCode);
        // A caller cannot pick a fresh partition by changing the header: every request is the same connection.
        Assert.Equal((HttpStatusCode)429, (await http.SendAsync(FromRailway("203.0.113.3", "152.233.29.1"))).StatusCode);
    }

    [Fact]
    public async Task An_unparseable_client_ip_header_falls_back_to_the_forwarded_address()
    {
        var (_, http) = NewHost(f =>
        {
            f.Overrides["RateLimit:PermitPerMinute"] = "2";
            f.Overrides["Proxy:TrustForwardedHeaders"] = "true";
            f.Overrides["Proxy:ClientIpHeader"] = "X-Real-IP";
        });

        HttpRequestMessage Bad()
        {
            var r = new HttpRequestMessage(HttpMethod.Get, "/api/account/status");
            r.Headers.Add("X-Forwarded-For", "203.0.113.7");
            r.Headers.Add("X-Real-IP", "not-an-ip");
            return r;
        }

        Assert.Equal(HttpStatusCode.OK, (await http.SendAsync(Bad())).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await http.SendAsync(Bad())).StatusCode);
        Assert.Equal((HttpStatusCode)429, (await http.SendAsync(Bad())).StatusCode);
    }

    [Fact]
    public async Task Forwarded_headers_can_be_switched_off()
    {
        var (_, http) = NewHost(f =>
        {
            f.Overrides["RateLimit:PermitPerMinute"] = "2";
            // Proxy:TrustForwardedHeaders deliberately unset: the default must not trust the header.
        });

        HttpRequestMessage From(string ip)
        {
            var r = new HttpRequestMessage(HttpMethod.Get, "/api/account/status");
            r.Headers.Add("X-Forwarded-For", ip);
            return r;
        }

        Assert.Equal(HttpStatusCode.OK, (await http.SendAsync(From("203.0.113.7"))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await http.SendAsync(From("203.0.113.8"))).StatusCode);
        // Different spoofed IPs share one bucket when the header is not trusted.
        Assert.Equal((HttpStatusCode)429, (await http.SendAsync(From("203.0.113.9"))).StatusCode);
    }

    [Fact]
    public async Task Role_change_in_the_database_is_reflected_in_the_next_refresh_token_claim()
    {
        var (f, http) = NewHost();
        var (_, setup) = await SetupAdmin(http);
        Assert.Equal("admin", RoleClaim(Str(setup, "accessToken")));

        Exec(f, "UPDATE Users SET Role='user' WHERE UsernameKey='admin'");
        var refreshed = await ExpectSession(
            await http.PostAsJsonAsync("/api/account/refresh", new { refreshToken = Str(setup, "refreshToken") }), HttpStatusCode.OK);

        Assert.Equal("user", RoleClaim(Str(refreshed, "accessToken")));
        Assert.Equal("user", refreshed.GetProperty("user").GetProperty("role").GetString());
    }

    private static string RoleClaim(string jwt) =>
        new System.IdentityModel.Tokens.Jwt.JwtSecurityTokenHandler().ReadJwtToken(jwt).Claims.First(c => c.Type == "role").Value;

    [Fact]
    public async Task Change_password_for_a_user_who_no_longer_exists_is_401_not_500()
    {
        var (f, http) = NewHost();
        var (admin, setup) = await SetupAdmin(http);
        Exec(f, "DELETE FROM Users");

        var res = await Authed(http, HttpMethod.Post, "/api/account/change-password", Str(setup, "accessToken"),
            ChangeBody(admin.AuthKey, NewCreds("admin")));

        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
    }
}
