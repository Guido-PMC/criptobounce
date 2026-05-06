import sys
from mexc_spot_v3 import mexc_wallet

import config as config

wallet = mexc_wallet()

# Enter parameters in JSON format in the "params", for example: {"symbol":"BTCUSDT", "limit":"200"}
# If there are no parameters, no need to send params
params = {
    "coin": "USDT",
    "network": "Tron(TRC20)",
    "address": "TDwdDjgigcd5K3hpXfn9rpFTKit1sehgB9",
    "amount": "3",
    # "memo": "xxx",
    # "withdrawOrderId": "xxx",
    # "remark": "xxx",
}
Withdraw = wallet.post_withdraw(params)
print(Withdraw)
