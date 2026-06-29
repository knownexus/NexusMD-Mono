using System.Text.Json;

namespace NexusMDWeb.Api.Services.OAuth;

/// <summary>Posts an x-www-form-urlencoded body to an OAuth token endpoint.</summary>
public sealed class HttpTokenExchanger(IHttpClientFactory http) : ITokenExchanger
{
    public async Task<TokenResponse> ExchangeAsync(string tokenEndpoint, IDictionary<string, string> form)
    {
        using var client = http.CreateClient();
        using var res = await client.PostAsync(tokenEndpoint, new FormUrlEncodedContent(form));
        var body = await res.Content.ReadAsStringAsync();
        if (!res.IsSuccessStatusCode)
            throw new HttpRequestException($"OAuth token endpoint returned {(int)res.StatusCode}: {body}");
        using var doc = JsonDocument.Parse(body);
        var root = doc.RootElement;
        return new TokenResponse(
            AccessToken:  root.TryGetProperty("access_token",  out var a) ? a.GetString() : null,
            RefreshToken: root.TryGetProperty("refresh_token", out var r) ? r.GetString() : null,
            ExpiresIn:    root.TryGetProperty("expires_in",    out var e) ? e.GetInt32()  : 3600);
    }
}
