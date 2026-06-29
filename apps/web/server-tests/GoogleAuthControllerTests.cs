using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using NexusMDWeb.Api.Services.OAuth;
using NexusMDWeb.Tests.Infrastructure;
using Xunit;

namespace NexusMDWeb.Tests;

public class GoogleAuthControllerTests
{
    // A fake exchanger so tests never hit Google.
    private sealed class FakeExchanger : ITokenExchanger
    {
        public Task<TokenResponse> ExchangeAsync(string endpoint, IDictionary<string, string> form)
            => Task.FromResult(new TokenResponse(
                AccessToken: "at-" + (form.TryGetValue("grant_type", out var g) ? g : "?"),
                RefreshToken: "rt-123",
                ExpiresIn: 3600));
    }

    // Simulates a non-error response that carries no access_token.
    private sealed class EmptyExchanger : ITokenExchanger
    {
        public Task<TokenResponse> ExchangeAsync(string endpoint, IDictionary<string, string> form)
            => Task.FromResult(new TokenResponse(null, null, 0));
    }

    private static WebApplicationFactory<Program> WithFake(TestFactory f) =>
        f.WithWebHostBuilder(b => b.ConfigureServices(s =>
        {
            s.AddSingleton<ITokenExchanger>(new FakeExchanger());
        }));

    private static WebApplicationFactory<Program> WithExchanger(TestFactory f, ITokenExchanger ex) =>
        f.WithWebHostBuilder(b => b.ConfigureServices(s => s.AddSingleton(ex)));

    [Fact]
    public async Task Url_contains_client_id_scope_and_redirect_but_no_secret()
    {
        using var f = new TestFactory();
        var client = WithFake(f).CreateClient();
        var res = await client.GetAsync("/api/google/auth/url?redirectUri=" + Uri.EscapeDataString("https://app/?from=google"));
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var url = JsonDocument.Parse(await res.Content.ReadAsStringAsync()).RootElement.GetProperty("url").GetString()!;
        Assert.Contains("accounts.google.com", url);
        Assert.Contains("drive.file", url);
        Assert.Contains("from%3Dgoogle", url); // redirect uri encoded
        Assert.DoesNotContain("test-google-secret", url);
    }

    [Fact]
    public async Task Callback_exchanges_code_for_tokens()
    {
        using var f = new TestFactory();
        var client = WithFake(f).CreateClient();
        var res = await client.PostAsJsonAsync("/api/google/auth/callback",
            new { code = "abc", redirectUri = "https://app/?from=google" });
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var j = JsonDocument.Parse(await res.Content.ReadAsStringAsync()).RootElement;
        Assert.Equal("at-authorization_code", j.GetProperty("accessToken").GetString());
        Assert.Equal("rt-123", j.GetProperty("refreshToken").GetString());
    }

    [Fact]
    public async Task Refresh_returns_a_new_access_token()
    {
        using var f = new TestFactory();
        var client = WithFake(f).CreateClient();
        var res = await client.PostAsJsonAsync("/api/google/auth/refresh", new { refreshToken = "rt-123" });
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var j = JsonDocument.Parse(await res.Content.ReadAsStringAsync()).RootElement;
        Assert.Equal("at-refresh_token", j.GetProperty("accessToken").GetString());
    }

    [Fact]
    public async Task Callback_returns_502_when_no_access_token_comes_back()
    {
        using var f = new TestFactory();
        var client = WithExchanger(f, new EmptyExchanger()).CreateClient();
        var res = await client.PostAsJsonAsync("/api/google/auth/callback",
            new { code = "abc", redirectUri = "https://app/?from=google" });
        Assert.Equal(HttpStatusCode.BadGateway, res.StatusCode);
    }
}
