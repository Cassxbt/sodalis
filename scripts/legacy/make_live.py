"""Writes live challenge letters for testnet: a test company key (kept in .keys/) signs each one."""
import base64, hashlib, json, os, sys, time
import dkim
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives import serialization

root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
keys, live = os.path.join(root, ".keys"), os.path.join(root, "live")
os.makedirs(live, exist_ok=True)
DOMAIN, SELECTOR = "corp.example", "bg2test"
company_file = os.path.join(keys, "company.json")
if not os.path.exists(company_file):
    k = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = k.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.TraditionalOpenSSL, serialization.NoEncryption()).decode()
    spki = k.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    json.dump({"domain": DOMAIN, "selector": SELECTOR, "pem": pem, "key_p": base64.b64encode(spki).decode()}, open(company_file, "w"))
company = json.load(open(company_file))

def letter(name, guild, wallet, frm="Dana Ruiz <dana@corp.example>", ttl=3600, tamper=False, to=None):
    to = to or frm.split("<")[-1].rstrip(">")
    salt = os.urandom(32).hex()
    commit = hashlib.sha256(f"blind-guild:v2:{guild}:{wallet}:{salt}".encode()).hexdigest()
    msg = (f"From: {frm}\r\nTo: {to}\r\nSubject: bg2 {commit} {int(time.time()) + ttl}\r\n"
           f"Date: {time.strftime('%a, %d %b %Y %H:%M:%S +0000', time.gmtime())}\r\nMessage-ID: <{os.urandom(6).hex()}@corp.example>\r\n\r\nJoining.\r\n").encode()
    eml = dkim.sign(msg, SELECTOR.encode(), DOMAIN.encode(), company["pem"].encode(), canonicalize=(b"relaxed", b"relaxed"),
                    include_headers=[b"from", b"to", b"subject", b"date", b"message-id"]) + msg
    if tamper:
        eml = eml.replace(b"Joining.", b"Leaving.")
    json.dump({"eml": eml.decode(), "salt": salt, "domain": DOMAIN, "selector": SELECTOR}, open(os.path.join(live, f"{name}.json"), "w"))
    print("wrote", name)

guild, admin = sys.argv[1], sys.argv[2]
m1, m2 = f"m1.{admin}", f"m2.{admin}"
letter("m1_dana", guild, m1)
letter("m2_dana_sybil", guild, m2)
letter("m2_tampered", guild, m2, frm="Lee Park <lee@corp.example>", tamper=True)
letter("m2_lee", guild, m2, frm="Lee Park <lee@corp.example>")
letter("m2_dana_plus_tag", guild, m2, frm="Dana <Dana+guild@corp.example>")
letter("m2_comment_trick", guild, m2, frm="lee@corp.example (<ceo@corp.example>)", to="lee@corp.example")
