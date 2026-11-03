namespace NexusMDWeb.Api.Services.Auth;

/// <summary>
/// Single rule for the JWT signing key, shared by the JWT bearer options (validation) and
/// <see cref="TokenService"/> (issuing). Jwt:SigningKey must be >= 32 bytes; it is mandatory
/// outside Development, where an ephemeral per-process key is used instead (tokens do not
/// survive a restart).
/// </summary>
public static class JwtKeyResolver
{
    private static readonly Lazy<string> DevEphemeralKey = new(() =>
        Convert.ToBase64String(System.Security.Cryptography.RandomNumberGenerator.GetBytes(48)));

    public static string Resolve(IConfiguration cfg, IHostEnvironment env)
    {
        var key = cfg["Jwt:SigningKey"];
        if (string.IsNullOrWhiteSpace(key))
        {
            if (!env.IsDevelopment())
                throw new InvalidOperationException("Jwt:SigningKey is required (>= 32 bytes) outside Development.");
            return DevEphemeralKey.Value; // Development only: tokens do not survive a restart.
        }
        if (System.Text.Encoding.UTF8.GetByteCount(key) < 32)
            throw new InvalidOperationException("Jwt:SigningKey must be at least 32 bytes.");
        return key;
    }

    public static string Issuer(IConfiguration cfg) => cfg["Jwt:Issuer"] ?? "nexusmd";
}
