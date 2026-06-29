namespace NexusMDWeb.Api.Services.OAuth;

public record TokenPair(string? AccessToken, string? RefreshToken);

public interface IOneTimeCodeStore
{
    /// <summary>Store tokens, return a single-use code bound to the provider (TTL 120s).</summary>
    string Put(string provider, TokenPair tokens);
    /// <summary>Redeem and remove a code; null if missing/expired/wrong provider.</summary>
    TokenPair? Redeem(string provider, string code);
}
