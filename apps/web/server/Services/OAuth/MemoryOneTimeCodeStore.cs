using Microsoft.Extensions.Caching.Memory;
using System.Security.Cryptography;

namespace NexusMDWeb.Api.Services.OAuth;

public sealed class MemoryOneTimeCodeStore(IMemoryCache cache) : IOneTimeCodeStore
{
    private static string Key(string provider, string code) => $"otc:{provider}:{code}";

    public string Put(string provider, TokenPair tokens)
    {
        var code = Convert.ToHexString(RandomNumberGenerator.GetBytes(24)).ToLowerInvariant();
        cache.Set(Key(provider, code), tokens, TimeSpan.FromSeconds(120));
        return code;
    }

    public TokenPair? Redeem(string provider, string code)
    {
        var k = Key(provider, code);
        if (cache.TryGetValue(k, out TokenPair? tokens)) { cache.Remove(k); return tokens; }
        return null;
    }
}
