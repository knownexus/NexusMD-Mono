using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using NexusMDWeb.Api.Services.OAuth;
using NexusMDWeb.Tests.Infrastructure;
using Xunit;

namespace NexusMDWeb.Tests;

public class OAuthNativeFlowTests
{
    private sealed class FakeExchanger : ITokenExchanger
    {
        public Task<TokenResponse> ExchangeAsync(string endpoint, IDictionary<string, string> form)
            => Task.FromResult(new TokenResponse("at-native", "rt-native", 3600));
    }

    // Simulates a non-error response that carries no access_token.
    private sealed class EmptyExchanger : ITokenExchanger
    {
        public Task<TokenResponse> ExchangeAsync(string endpoint, IDictionary<string, string> form)
            => Task.FromResult(new TokenResponse(null, null, 0));
    }

    private static WebApplicationFactory<Program> WithFake(TestFactory f) =>
        f.WithWebHostBuilder(b => b.ConfigureServices(s => s.AddSingleton<ITokenExchanger>(new FakeExchanger())));

    private static WebApplicationFactory<Program> WithExchanger(TestFactory f, ITokenExchanger ex) =>
        f.WithWebHostBuilder(b => b.ConfigureServices(s => s.AddSingleton(ex)));

    private static string EncodeState(string returnUri)
        => Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(returnUri))
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');

    [Fact]
    public async Task NativeUrl_targets_backend_callback_and_carries_returnUri_in_state()
    {
        using var f = new TestFactory();
        var client = WithFake(f).CreateClient();
        var res = await client.GetAsync("/api/google/auth/native-url?returnUri=" + Uri.EscapeDataString("nexusmd://oauth/gdrive"));
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var url = JsonDocument.Parse(await res.Content.ReadAsStringAsync()).RootElement.GetProperty("url").GetString()!;
        Assert.Contains("accounts.google.com", url);
        Assert.Contains("native-callback", url);                 // redirect_uri is the backend
        Assert.Contains("state=", url);                          // returnUri carried in state
        Assert.DoesNotContain("test-google-secret", url);
    }

    [Fact]
    public async Task NativeUrl_rejects_a_returnUri_not_on_the_allow_list()
    {
        using var f = new TestFactory();
        var client = WithFake(f).CreateClient();
        var res = await client.GetAsync("/api/google/auth/native-url?returnUri=" + Uri.EscapeDataString("https://evil.example/steal"));
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task Callback_redirects_to_returnUri_with_a_one_time_code_then_exchange_returns_tokens()
    {
        using var f = new TestFactory();
        var factory = WithFake(f);
        // Do not auto-follow the 302 so we can read the Location header.
        var client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

        // Build a state that encodes the returnUri (base64url of the raw returnUri).
        var returnUri = "nexusmd://oauth/gdrive";
        var state = Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(returnUri))
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');

        var cb = await client.GetAsync($"/api/google/auth/native-callback?code=abc&state={state}");
        Assert.Equal(HttpStatusCode.Redirect, cb.StatusCode);
        var location = cb.Headers.Location!.ToString();
        Assert.StartsWith("nexusmd://oauth/gdrive", location);
        Assert.Contains("otc=", location);

        var otc = System.Web.HttpUtility.ParseQueryString(new Uri(location).Query)["otc"]!;
        var ex = await client.PostAsJsonAsync("/api/google/auth/exchange", new { code = otc });
        Assert.Equal(HttpStatusCode.OK, ex.StatusCode);
        var j = JsonDocument.Parse(await ex.Content.ReadAsStringAsync()).RootElement;
        Assert.Equal("at-native", j.GetProperty("accessToken").GetString());
        Assert.Equal("rt-native", j.GetProperty("refreshToken").GetString());

        // OTC is single-use: a second exchange fails.
        var ex2 = await client.PostAsJsonAsync("/api/google/auth/exchange", new { code = otc });
        Assert.Equal(HttpStatusCode.BadRequest, ex2.StatusCode);
    }

    [Fact]
    public async Task Google_native_callback_returns_502_when_no_access_token()
    {
        using var f = new TestFactory();
        var client = WithExchanger(f, new EmptyExchanger())
            .CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        var state = EncodeState("nexusmd://oauth/gdrive");
        var res = await client.GetAsync($"/api/google/auth/native-callback?code=abc&state={state}");
        Assert.Equal(HttpStatusCode.BadGateway, res.StatusCode);
    }

    [Fact]
    public async Task Ms_native_url_targets_backend_callback_and_carries_returnUri_in_state()
    {
        using var f = new TestFactory();
        var client = WithFake(f).CreateClient();
        var res = await client.GetAsync("/api/ms/auth/native-url?returnUri=" + Uri.EscapeDataString("nexusmd://oauth/onedrive"));
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var url = JsonDocument.Parse(await res.Content.ReadAsStringAsync()).RootElement.GetProperty("url").GetString()!;
        Assert.Contains("login.microsoftonline.com", url);
        Assert.Contains("native-callback", url);
        Assert.Contains("state=", url);
        Assert.DoesNotContain("test-ms-secret", url);
    }

    [Fact]
    public async Task Ms_native_url_rejects_a_returnUri_not_on_the_allow_list()
    {
        using var f = new TestFactory();
        var client = WithFake(f).CreateClient();
        var res = await client.GetAsync("/api/ms/auth/native-url?returnUri=" + Uri.EscapeDataString("https://evil.example/steal"));
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task Ms_callback_redirects_with_one_time_code_then_exchange_returns_tokens()
    {
        using var f = new TestFactory();
        var client = WithFake(f)
            .CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        var state = EncodeState("nexusmd://oauth/onedrive");

        var cb = await client.GetAsync($"/api/ms/auth/native-callback?code=abc&state={state}");
        Assert.Equal(HttpStatusCode.Redirect, cb.StatusCode);
        var location = cb.Headers.Location!.ToString();
        Assert.StartsWith("nexusmd://oauth/onedrive", location);
        Assert.Contains("provider=onedrive", location);
        Assert.Contains("otc=", location);

        var otc = System.Web.HttpUtility.ParseQueryString(new Uri(location).Query)["otc"]!;
        var ex = await client.PostAsJsonAsync("/api/ms/auth/exchange", new { code = otc });
        Assert.Equal(HttpStatusCode.OK, ex.StatusCode);
        var j = JsonDocument.Parse(await ex.Content.ReadAsStringAsync()).RootElement;
        Assert.Equal("at-native", j.GetProperty("accessToken").GetString());

        // Single-use: redeeming again fails.
        var ex2 = await client.PostAsJsonAsync("/api/ms/auth/exchange", new { code = otc });
        Assert.Equal(HttpStatusCode.BadRequest, ex2.StatusCode);
    }

    [Fact]
    public async Task Otc_is_bound_to_its_provider()
    {
        using var f = new TestFactory();
        var client = WithFake(f)
            .CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

        // Mint a code via the Google native callback…
        var state = EncodeState("nexusmd://oauth/gdrive");
        var cb = await client.GetAsync($"/api/google/auth/native-callback?code=abc&state={state}");
        var otc = System.Web.HttpUtility.ParseQueryString(new Uri(cb.Headers.Location!.ToString()).Query)["otc"]!;

        // …it must NOT be redeemable through the Microsoft exchange.
        var wrong = await client.PostAsJsonAsync("/api/ms/auth/exchange", new { code = otc });
        Assert.Equal(HttpStatusCode.BadRequest, wrong.StatusCode);
    }
}
