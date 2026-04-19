'use strict';

/**
 * CIF-based landed cost pricing formula.
 * Single source of truth — mirrors src/utils/pricing.js exactly.
 *
 * Formula (per the Excel pricing model):
 *   Insurance  = ListPrice × insuranceRate   (Hardware + foreign currency only)
 *   Freight    = ListPrice × freightRate     (Hardware + foreign currency only)
 *   CIF        = ListPrice + Insurance + Freight
 *   Duty       = CIF × dutyRate              (Hardware + foreign currency only)
 *   Handling   = CIF × handlingRate          (Hardware only, any currency)
 *   T&A        = CIF × transferAdminRate     (always, except Service)
 *   Total      = CIF + Duty + Handling + T&A
 *   Markup     = CIF × markupRate            (always, except Service)
 *   Selling    = Total + Markup
 *   FinalGHS   = Selling × fxRate            (only if currency !== 'GHS')
 *
 * When item-level cost overrides exist (non-zero), those absolute values are
 * used instead of the preset rate calculation.
 */
const calculateLandedCost = (item, presets = {}) => {
    if (!item) return { finalGHS: 0 };

    const listPrice   = item.price || 0;
    const itemType    = item.itemType || 'Hardware';
    const currency    = (item.currency || 'GHS').toUpperCase();
    const cost        = item.costComponents || {};

    const insuranceRate    = presets.insurancePct ?? 0.01;
    const freightRate      = presets.freightPct ?? 0.12;
    const dutyRate         = presets.dutyPct ?? 0.50;
    const handlingRate     = presets.handlingPct ?? 0.02;
    const transferAdminRate = presets.transferAdminPct ?? 0.015;
    const defaultMarkup    = presets.defaultMarkupPct ?? 30;
    const defaultFx        = presets.defaultFxRate ?? 13.05;

    const isHardware   = itemType === 'Hardware';
    const isService    = itemType === 'Service';
    const isForeign    = currency !== 'GHS';

    if (isService) {
        return {
            insurance: 0, freight: 0, cif: listPrice,
            duty: 0, handling: 0, transferAdmin: 0,
            total: listPrice, markup: 0, selling: listPrice,
            fxRate: 1, finalGHS: listPrice
        };
    }

    let insurance = 0;
    let freight = 0;
    if (isHardware && isForeign) {
        insurance = cost.insurancePerUnit || (listPrice * insuranceRate);
        freight   = cost.inboundFreightPerUnit || (listPrice * freightRate);
    }

    const cif = listPrice + insurance + freight;

    let duty = 0;
    if (isHardware && isForeign) {
        duty = cost.dutyPerUnit || (cif * dutyRate);
    }

    let handling = 0;
    if (isHardware) {
        handling = cost.handlingPerUnit || (cif * handlingRate);
    }

    let transferAdmin = cost.transferAdminPerUnit || (cif * transferAdminRate);

    const total = cif + duty + handling + transferAdmin;

    const markupPct = item.markupOverridePercent ?? defaultMarkup;
    const markup = cif * (markupPct / 100);

    const selling = total + markup;

    const fxRate = isForeign ? (presets.defaultFxRate ?? defaultFx) : 1;
    const finalGHS = selling * fxRate;

    return {
        insurance: Number(insurance.toFixed(4)),
        freight: Number(freight.toFixed(4)),
        cif: Number(cif.toFixed(4)),
        duty: Number(duty.toFixed(4)),
        handling: Number(handling.toFixed(4)),
        transferAdmin: Number(transferAdmin.toFixed(4)),
        total: Number(total.toFixed(4)),
        markup: Number(markup.toFixed(4)),
        selling: Number(selling.toFixed(4)),
        fxRate,
        finalGHS: Number(finalGHS.toFixed(2))
    };
};

const calculateFinalPrice = (item, presets = {}) => {
    return calculateLandedCost(item, presets).finalGHS;
};

module.exports = { calculateFinalPrice, calculateLandedCost };
