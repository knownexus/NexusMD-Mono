using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using NexusMDWeb.Tests.Infrastructure;
using Xunit;

namespace NexusMDWeb.Tests;

/// <summary>The sync-format gate: writes from clients below Sync:MinFormat get 426 client_outdated; reads are never gated.</summary>
public sealed class SyncFormatGateTests : IDisposable
{
    private const string SetupToken = "test-setup-token";

    private readonly List<TestFactory> _factories = new();

    public void Dispose()
    {
        foreach (var f in _factories) f.Dispose();
        SqliteConnection.ClearAllPools();
    }

    private static string RandB64(int n) => Convert.ToBase64String(RandomNumberGenerator.GetBytes(n));

    private async Task<(HttpClient http, string token, string device)> NewHost(string? minFormat)
    {
        var f = new TestFactory();
        if (minFormat != null) f.Overrides["Sync:MinFormat"] = minFormat;
        _factories.Add(f);
        var http = f.CreateClient();
        var res = await http.PostAsJsonAsync("/api/account/setup", new
        {
            username = "admin", salt = RandB64(16), iterations = 600000, authKey = RandB64(32),
            publicKey = RandB64(91), wrappedPrivateKey = RandB64(120), wrappedContainerKey = RandB64(60),
            setupToken = SetupToken,
        });
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        var token = JsonDocument.Parse(await res.Content.ReadAsStringAsync()).RootElement.GetProperty("accessToken").GetString()!;
        var dev = await Send(http, HttpMethod.Post, "/api/devices", token, new { name = "Laptop", platform = "windows" }, null, "2");
        Assert.Equal(HttpStatusCode.Created, dev.StatusCode);
        var id = JsonDocument.Parse(await dev.Content.ReadAsStringAsync()).RootElement.GetProperty("id").GetString()!;
        return (http, token, id);
    }

    private static Task<HttpResponseMessage> Send(HttpClient http, HttpMethod method, string url, string token,
        object? body = null, string? ifMatch = null, string? format = null)
    {
        var req = new HttpRequestMessage(method, url);
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        if (ifMatch != null) req.Headers.TryAddWithoutValidation("If-Match", ifMatch);
        if (format != null) req.Headers.TryAddWithoutValidation("X-Sync-Format", format);
        if (body != null) req.Content = JsonContent.Create(body);
        return http.SendAsync(req);
    }

    private static async Task AssertOutdated(HttpResponseMessage res)
    {
        Assert.Equal((HttpStatusCode)426, res.StatusCode);
        var body = JsonDocument.Parse(await res.Content.ReadAsStringAsync()).RootElement;
        Assert.Equal("client_outdated", body.GetProperty("code").GetString());
    }

    [Fact]
    public async Task Writes_below_min_format_get_426_client_outdated()
    {
        var (http, token, dev) = await NewHost("2");
        await AssertOutdated(await Send(http, HttpMethod.Put, "/api/items/abcdefgh", token, new { ciphertext = "AAAA", deleted = false }, "0"));
        await AssertOutdated(await Send(http, HttpMethod.Post, "/api/items/batch", token, new { items = Array.Empty<object>() }));
        await AssertOutdated(await Send(http, HttpMethod.Put, $"/api/devices/{dev}/prefs", token, new { ciphertext = "AAAA" }, "0"));
        // An unparsable header counts as format 1.
        await AssertOutdated(await Send(http, HttpMethod.Put, "/api/items/abcdefgh", token, new { ciphertext = "AAAA", deleted = false }, "0", "banana"));
        await AssertOutdated(await Send(http, HttpMethod.Put, "/api/items/abcdefgh", token, new { ciphertext = "AAAA", deleted = false }, "0", "1"));
    }

    [Fact]
    public async Task Writes_at_min_format_succeed()
    {
        var (http, token, dev) = await NewHost("2");
        var put = await Send(http, HttpMethod.Put, "/api/items/abcdefgh", token, new { ciphertext = "AAAA", deleted = false }, "0", "2");
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);
        var batch = await Send(http, HttpMethod.Post, "/api/items/batch", token, new { items = Array.Empty<object>() }, null, "2");
        Assert.Equal(HttpStatusCode.OK, batch.StatusCode);
        var prefs = await Send(http, HttpMethod.Put, $"/api/devices/{dev}/prefs", token, new { ciphertext = "AAAA" }, "0", "2");
        Assert.Equal(HttpStatusCode.OK, prefs.StatusCode);
    }

    [Fact]
    public async Task Reads_are_not_gated()
    {
        var (http, token, dev) = await NewHost("2");
        Assert.Equal(HttpStatusCode.OK, (await Send(http, HttpMethod.Get, "/api/items/changes", token)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Send(http, HttpMethod.Get, $"/api/devices/{dev}/prefs", token)).StatusCode);
    }

    [Fact]
    public async Task Default_min_format_accepts_old_clients()
    {
        var (http, token, _) = await NewHost(null);
        var put = await Send(http, HttpMethod.Put, "/api/items/abcdefgh", token, new { ciphertext = "AAAA", deleted = false }, "0");
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);
    }
}
