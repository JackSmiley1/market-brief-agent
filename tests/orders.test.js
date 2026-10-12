// Tests for src/orders.js's buildCloseOrder: closing a position by its own
// quantity, so a nightly close can never liquidate a buy-and-hold fund
// position in the same ticker (see the comment in src/orders.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCloseOrder } from "../src/orders.js";

test("long stock closes with a sell for exactly its own qty (fractional kept)", () => {
  assert.deepEqual(buildCloseOrder({ ticker: "SPY", direction: "long", qty: 1.6734 }), {
    symbol: "SPY", qty: "1.6734", side: "sell", type: "market", time_in_force: "day",
  });
});

test("short stock closes with a buy-to-cover for its own qty", () => {
  const o = buildCloseOrder({ ticker: "QQQ", direction: "short", qty: 3 });
  assert.equal(o.side, "buy");
  assert.equal(o.qty, "3");
});

test("crypto falls back to the whole-symbol close (fees make held qty < filled qty)", () => {
  assert.equal(buildCloseOrder({ ticker: "BTC/USD", direction: "long", qty: 0.01 }), null);
});

test("missing or invalid qty falls back (pre-qty-tracking rows)", () => {
  assert.equal(buildCloseOrder({ ticker: "AAPL", direction: "long", qty: null }), null);
  assert.equal(buildCloseOrder({ ticker: "AAPL", direction: "long", qty: 0 }), null);
  assert.equal(buildCloseOrder({ ticker: "AAPL", direction: "long", qty: "abc" }), null);
});

import { positionPathSymbol } from "../src/orders.js";

test("positions path uses Alpaca's unslashed crypto symbol (BTC/USD -> BTCUSD)", () => {
  assert.equal(positionPathSymbol("BTC/USD"), "BTCUSD");
  assert.equal(positionPathSymbol("ETH/USD"), "ETHUSD");
});

test("positions path leaves stock symbols unchanged", () => {
  assert.equal(positionPathSymbol("SPY"), "SPY");
});

import { tradingHalted } from "../src/orders.js";

test("kill switch: only an explicit 'true' halts trading", () => {
  assert.equal(tradingHalted({ TRADING_HALTED: "true" }), true);
  assert.equal(tradingHalted({ TRADING_HALTED: " TRUE " }), true);
  assert.equal(tradingHalted({ TRADING_HALTED: "false" }), false);
  assert.equal(tradingHalted({ TRADING_HALTED: "" }), false);
  assert.equal(tradingHalted({}), false);
});

import { isUnshortableRejection, closeSourcesFor } from "../src/orders.js";

test("Alpaca's 'cannot be sold short' rejection is recognized (ORCL, 2026-10-08)", () => {
  assert.equal(isUnshortableRejection({ code: 42210000, message: 'asset "ORCL" cannot be sold short' }), true);
});

test("other order errors are still treated as real failures", () => {
  assert.equal(isUnshortableRejection({ code: 40310000, message: "insufficient buying power" }), false);
  assert.equal(isUnshortableRejection(undefined), false);
});

test("weekend runs close crypto only; weekdays close everything", () => {
  assert.deepEqual(closeSourcesFor({ CRYPTO_ONLY_CLOSE: "true" }), ["nightly_crypto", "crypto_ondemand"]);
  assert.equal(closeSourcesFor({}), null);
});
