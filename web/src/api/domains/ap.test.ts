import { describe, expect, it } from 'vitest';
import { supportedRadios, widthOptions, WIDTH_LABEL } from './ap';

describe('supportedRadios', () => {
  it('follows deviceMisc band flags', () => {
    expect(
      supportedRadios({ mac: 'x', deviceMisc: { support2g: true, support5g: true, support5g2: false, support6g: false } }),
    ).toEqual(['radioSetting2g', 'radioSetting5g']);
    expect(supportedRadios({ mac: 'x', deviceMisc: { support2g: false, support5g: true, support6g: true } })).toEqual([
      'radioSetting5g',
      'radioSetting6g',
    ]);
  });

  it('falls back to the radio blocks present when deviceMisc is missing', () => {
    expect(supportedRadios({ mac: 'x', radioSetting2g: {}, radioSetting5g: {} })).toEqual(['radioSetting2g', 'radioSetting5g']);
  });
});

describe('widthOptions', () => {
  it('starts with the band-specific auto value and has a label for every option', () => {
    expect(widthOptions('radioSetting2g')[0]).toBe('4');
    expect(widthOptions('radioSetting5g')[0]).toBe('6');
    expect(widthOptions('radioSetting6g')[0]).toBe('8');
    for (const r of ['radioSetting2g', 'radioSetting5g', 'radioSetting5g2', 'radioSetting6g'] as const) {
      for (const w of widthOptions(r)) expect(WIDTH_LABEL[w]).toBeTruthy();
    }
  });
});
