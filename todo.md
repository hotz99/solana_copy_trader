1.  EDGE CASE:
    a custom “router” or wrapper that, as an inner call, invokes a DEX program “buy/sell/swap” instruction.

        Outer ix: a custom program (likely a front-end aggregator or router)
        Inner ix: the actual DEX instruction, which that router is dispatching internally

solution (?): process inner instructions when looking for DEX instructions

2. test buy/sell with priority fees
