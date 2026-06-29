namespace NexusMDWeb.Api.Services.OAuth;

public record TokenResponse(string? AccessToken, string? RefreshToken, int ExpiresIn);

public interface ITokenExchanger
{
    Task<TokenResponse> ExchangeAsync(string tokenEndpoint, IDictionary<string, string> form);
}
