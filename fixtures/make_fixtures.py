"""Signs v2 challenge emails with dkimpy and records what each case must produce."""
import base64, hashlib, json, os, sys
import dkim
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives import serialization

NOW = 1_794_000_000
GUILD, WALLET, ATTACKER = "bg.guild.testnet", "anon-7f3a.testnet", "attacker.testnet"
DOMAIN, SELECTOR = "acme-test.org", "s1"

def keypair():
    k = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = k.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.TraditionalOpenSSL, serialization.NoEncryption())
    spki = k.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    return pem, base64.b64encode(spki).decode()

def commitment(guild, wallet, salt):
    return hashlib.sha256(f"blind-guild:v2:{guild}:{wallet}:{salt}".encode()).hexdigest()

acme_pem, acme_p = keypair()
other_pem, other_p = keypair()
SALT = os.urandom(32).hex()

def subject(guild=GUILD, wallet=WALLET, salt=SALT, expiry=NOW + 3600):
    return f"bg2 {commitment(guild, wallet, salt)} {expiry}"

def mail(frm="Dana Ruiz <dana@acme-test.org>", subj=None, body="Joining.\r\n", extra="", to="dana@acme-test.org"):
    return (f"From: {frm}\r\nTo: {to}\r\nSubject: {subj or subject()}\r\n"
            f"Date: Tue, 10 Nov 2026 06:00:00 +0000\r\nMessage-ID: <a1@acme-test.org>\r\n{extra}\r\n{body}").encode()

def sign(msg, domain=DOMAIN.encode(), selector=SELECTOR.encode(), pem=None, headers=None, **kw):
    sig = dkim.sign(msg, selector, domain, pem or acme_pem, canonicalize=(b"relaxed", b"relaxed"),
                    include_headers=headers or [b"from", b"to", b"subject", b"date", b"message-id"], **kw)
    return sig + msg

cases = []
def add(name, eml, expect, wallet=WALLET, salt=SALT, guild=GUILD, key_p=acme_p, domain=DOMAIN, selector=SELECTOR, seal_to=GUILD):
    ref = dkim.verify(eml, dnsfunc=lambda n, timeout=5: f"v=DKIM1; k=rsa; p={key_p}".encode())
    cases.append({"name": name, "expect": expect, "dkimpy_says_valid": bool(ref), "wallet": wallet, "now": NOW,
                  "seal_to": seal_to, "letter": {"eml": eml.decode(), "salt": salt},
                  "input": {"action": "verify", "guild": guild, "wallet": wallet, "domain": domain, "selector": selector, "key_p": key_p}})

good = sign(mail())
add("valid challenge", good, "ok")
add("folded subject and headers", sign(mail(subj=f"bg2\r\n {commitment(GUILD, WALLET, SALT)}   {NOW + 600}", extra="X-Note: a\r\n\tb\r\n")), "ok")
add("stolen sealed letter replayed by another wallet", good, "bound to a different wallet or guild", wallet=ATTACKER)
add("sealed letter replayed into another guild", good, "does not open with this guild's inbox key", guild="other.guild.testnet")
add("same letter re-sealed by its owner for another guild", good, "bound to a different wallet or guild", guild="other.guild.testnet", seal_to="other.guild.testnet")
add("salt swapped to fit attacker wallet", good, "bound to a different wallet or guild", wallet=ATTACKER, salt=os.urandom(32).hex())
add("short salt refused", sign(mail(subj=subject(salt="ab"))), "salt must be 32 random bytes", salt="ab")
add("tampered subject", good.replace(commitment(GUILD, WALLET, SALT).encode(), commitment(GUILD, ATTACKER, SALT).encode()), "signature invalid", wallet=ATTACKER)
add("tampered body", good.replace(b"Joining", b"Leaving"), "body hash mismatch")
add("expired challenge", sign(mail(subj=subject(expiry=NOW - 60))), "challenge expired")
add("challenge lifetime over 24h", sign(mail(subj=subject(expiry=NOW + 90000))), "exceeds 24h")
add("signed by another company's key", sign(mail(frm="eve@other-corp.org"), domain=b"other-corp.org", pem=other_pem), "signature invalid")
add("other company, its own real key", sign(mail(frm="eve@other-corp.org"), domain=b"other-corp.org", pem=other_pem), "pinned domain key", key_p=other_p)
add("selector differs from the pinned one", sign(mail(), selector=b"s2"), "pinned domain key")
add("subject not signed", sign(mail(), headers=[b"from", b"to", b"date"]), "subject header is not covered")
add("From misaligned with d=", sign(mail(frm="dana@gmail.com", to="dana@gmail.com")), "not aligned")
add("From comment hides a second address", sign(mail(frm="dana@acme-test.org (<ceo@acme-test.org>)")), "plain mailbox")
add("quoted display name with an address", sign(mail(frm='"ceo@acme-test.org" <dana@acme-test.org>')), "display name may not contain an address")
add("two addresses in From", sign(mail(frm="dana@acme-test.org, ceo@acme-test.org")), "plain mailbox")
add("sent to another mailbox", sign(mail(to="dana.home@proton.me")), "ok")
add("To with a quoted address as display name (Proton)", sign(mail(to='"dana.home@proton.me" <dana.home@proton.me>')), "ok")
add("quoted To hiding a second recipient", sign(mail(to='"x" <a@b.org>, c@d.org')), "plain mailbox")
add("role mailbox echo (support@)", sign(mail(frm="Support <support@acme-test.org>", to="eve@evil.example")), "role and no-reply")
add("role mailbox via +tag (No-Reply+x@)", sign(mail(frm="No-Reply+x@acme-test.org")), "role and no-reply")
add("two addresses in To", sign(mail(to="dana@acme-test.org, ceo@acme-test.org")), "plain mailbox")
add("To not covered by signature", sign(mail(), headers=[b"from", b"subject", b"date"]), "to header is not covered")
weak_pem, weak_p = (lambda k: (k.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.TraditionalOpenSSL, serialization.NoEncryption()),
    base64.b64encode(k.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)).decode()))(
    rsa.generate_private_key(public_exponent=65537, key_size=1024))
add("1024-bit pinned key refused", sign(mail(), pem=weak_pem), "shorter than 2048", key_p=weak_p)
huge_a = good.replace(b"a=rsa-sha256", b"a=" + b"x" * 4200, 1)
add("oversized a= is not echoed", huge_a, "algorithm refused")
add("second From injected", b"From: ceo@acme-test.org\r\n" + good, "exactly one from header")
add("rsa-sha1 refused", sign(mail(), signature_algorithm=b"rsa-sha1"), "only rsa-sha256")
add("l= tag refused", sign(mail(), length=True), "l= body length limit refused")
add("v1 subject format refused", sign(mail(subj=f"blind-guild v1 {GUILD} {WALLET} {NOW + 3600}")), "not a blind-guild v2 challenge")
second_salt, third_salt = os.urandom(32).hex(), os.urandom(32).hex()
add("same mailbox via +tag, third wallet (Sybil)", sign(mail(frm="Dana <Dana+guild@acme-test.org>", to="dana+x@acme-test.org", subj=subject(wallet="third.testnet", salt=third_salt))), "ok", wallet="third.testnet", salt=third_salt)
add("same person, second wallet (Sybil)", sign(mail(subj=subject(wallet="second.testnet", salt=second_salt))), "ok", wallet="second.testnet", salt=second_salt)
json.dump(cases, open(sys.argv[1], "w"), indent=1)
print(len(cases), "cases")
