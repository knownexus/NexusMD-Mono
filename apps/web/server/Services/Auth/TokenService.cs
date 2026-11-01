using System.IdentityModel.Tokens.Jwt;
using System.Security.Cryptography;
using System.Text;
using Microsoft.IdentityModel.Tokens;
using NexusMDWeb.Api.Models;

namespace NexusMDWeb.Api.Services.Auth;

/// <summary>
/// Issues short-lived JWT access tokens and opaque refresh tokens. Refresh tokens are random;
/// only their SHA-256 hex hash is ever stored. Claims use short names (<c>sub</c>, <c>role</c>,
/// <c>unique_name</c>) because the bearer handler runs with MapInboundClaims=false.
/// </summary>
public sealed class TokenService
{
    private readonly SymmetricSecurityKey _key;
    private readonly string _issuer;
    private readonly int _accessSeconds;

    public TokenService(IConfiguration config, IHostEnvironment env)
    {
        _key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(JwtKeyResolver.Resolve(config, env)));
        _issuer = JwtKeyResolver.Issuer(config);
        var minutes = int.TryParse(config["Jwt:AccessMinutes"], out var m) && m > 0 ? m : 15;
        _accessSeconds = minutes * 60;
    }

    public (string token, int expiresInSeconds) IssueAccess(UserRecord user)
    {
        var now = DateTime.UtcNow;
        var jwt = new JwtSecurityToken(
            issuer: _issuer,
            claims: new[]
            {
                new System.Security.Claims.Claim(JwtRegisteredClaimNames.Sub, user.Id),
                new System.Security.Claims.Claim("unique_name", user.Username),
                new System.Security.Claims.Claim("role", user.Role),
                new System.Security.Claims.Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString("N")),
            },
            notBefore: now,
            expires: now.AddSeconds(_accessSeconds),
            signingCredentials: new SigningCredentials(_key, SecurityAlgorithms.HmacSha256));
        return (new JwtSecurityTokenHandler().WriteToken(jwt), _accessSeconds);
    }

    public (string token, string hash) NewRefreshToken()
    {
        var token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(48))
            .Replace('+', '-').Replace('/', '_').TrimEnd('=');
        return (token, HashRefresh(token));
    }

    public string HashRefresh(string token) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token))).ToLowerInvariant();
}
