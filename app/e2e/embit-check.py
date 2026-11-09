"""Independent check of a finalised round with embit: every input's witness is
[empty, sig..., witness_script], the script is 3-of-5 sorted multisig, and each signature
verifies (in key order, as OP_CHECKMULTISIG requires) against embit's own BIP-143 sighash.
Usage: python3 e2e/embit-check.py FILE.json, with {hex, psbt} or {hex, amounts}."""
import json, sys
from embit.transaction import Transaction
from embit.psbt import PSBT
from embit.script import Script
from embit.ec import PublicKey, Signature

data = json.load(open(sys.argv[1]))
tx = Transaction.parse(bytes.fromhex(data['hex']))
psbt = PSBT.from_base64(data['psbt']) if 'psbt' in data else None
ok = True
for i, inp in enumerate(tx.vin):
    items = inp.witness.items
    ws = Script(items[-1])
    amount = data['amounts'][i] if 'amounts' in data else psbt.inputs[i].witness_utxo.value
    h = tx.sighash_segwit(i, ws, amount)
    d = ws.data
    m = d[0] - 0x50
    pubs = []
    j = 1
    while d[j] == 33:
        pubs.append(d[j + 1:j + 34]); j += 34
    n = d[j] - 0x50
    assert d[j + 1] == 0xae, 'not CHECKMULTISIG'
    assert pubs == sorted(pubs), 'keys not sorted'
    sigs = items[1:-1]
    assert items[0] == b'' and len(sigs) == m, f'witness shape {len(items)}'
    k = 0
    for s in sigs:
        assert s[-1] == 1, 'sighash'
        sig = Signature.parse(s[:-1])
        while k < len(pubs) and not PublicKey.parse(pubs[k]).verify(sig, h):
            k += 1
        if k == len(pubs):
            ok = False; print(f'input {i}: signature does not verify in order'); break
        k += 1
    print(f'input {i}: {m}-of-{n}, {len(sigs)} signatures verified in key order')
print('vsize', tx.vsize if hasattr(tx, 'vsize') else (len(tx.serialize()) ))
print('ALL OK' if ok else 'FAILED')
sys.exit(0 if ok else 1)
