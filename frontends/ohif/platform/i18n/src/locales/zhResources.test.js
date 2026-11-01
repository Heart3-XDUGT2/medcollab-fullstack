import fs from 'fs';
import path from 'path';
import i18next from 'i18next';
import chinese from './zh';
import english from './en-US';

const excludedSpecialtyNamespaces = new Set(['PanelSUV', 'ROIThresholdConfiguration', 'USAnnotationPanel']);
const tokens = value =>
  [...value.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)].map(match => match[1].trim()).sort();

describe('Simplified Chinese common-path resources', () => {
  test('all JSON files parse and every supported common namespace/key is registered', () => {
    for (const locale of ['zh', 'en-US']) {
      for (const name of fs.readdirSync(path.join(__dirname, locale)).filter(name => name.endsWith('.json'))) {
        expect(() => JSON.parse(fs.readFileSync(path.join(__dirname, locale, name), 'utf8'))).not.toThrow();
      }
    }
    for (const [namespace, resources] of Object.entries(english['en-US'])) {
      if (excludedSpecialtyNamespaces.has(namespace)) continue;
      expect(chinese.zh[namespace]).toBeDefined();
      for (const [key, value] of Object.entries(resources)) {
        const translated = chinese.zh[namespace][key];
        expect(typeof translated).toBe('string');
        expect(translated.trim().length).toBeGreaterThan(0);
        // Values, not keys, carry placeholders such as {{trackedSeries}}.
        expect(tokens(translated)).toEqual(tokens(value));
      }
    }
  });

  test('interpolation, nesting, count use and English switching work in the installed i18next', async () => {
    const instance = i18next.createInstance();
    await instance.init({
      lng: 'zh', fallbackLng: 'en-US', resources: { ...english, ...chinese },
      keySeparator: false, interpolation: { escapeValue: false },
    });
    expect(instance.t('Tools:Segment')).toBe('分割区域');
    expect(instance.t('Tools:Segmentation')).toBe('分割');
    expect(instance.t('Buttons:Brush')).toBe('画笔');
    expect(instance.t('Buttons:Pan')).toBe('平移');
    expect(instance.t('Buttons:Window Level')).toBe('窗宽/窗位');
    expect(instance.t('StudyItem:Tracked series', { trackedSeries: 3 })).toBe('3 个已跟踪序列');
    expect(instance.t('DataTable:{{count}} per page', { count: 25 })).toBe('每页 25 条');
    expect(instance.t('UserPreferencesModal:Hotkey is already in use', { defaultValue: 'fallback' })).toBe('fallback');
    expect(instance.t('HotkeysValidators:Hotkey is already in use', { action: '缩放', pressedKeys: 'Z' }))
      .toBe('“缩放”已使用快捷键“Z”。');
    expect(instance.t('Buttons:Layout')).toBe('布局');
    await instance.changeLanguage('en-US');
    expect(instance.t('Buttons:Brush')).toBe('Brush');
    expect(instance.t('StudyItem:Tracked series', { trackedSeries: 3 })).toBe('3 Tracked series');
    expect(instance.t('DataTable:{{count}} per page', { count: 1 })).toBe('1 per page');
  });

  test('existing plural suffixes and nested resource references stay resolvable', async () => {
    const instance = i18next.createInstance();
    await instance.init({ lng: 'zh', fallbackLng: 'en-US', resources: { ...english, ...chinese }, keySeparator: false });
    for (const [namespace, resources] of Object.entries(english['en-US'])) {
      if (excludedSpecialtyNamespaces.has(namespace)) continue;
      for (const [key, value] of Object.entries(resources)) {
        if (/_plural$|_one$|_other$/.test(key)) expect(chinese.zh[namespace][key]).toBeDefined();
        for (const match of chinese.zh[namespace][key].matchAll(/\$t\(([^)]+)\)/g)) {
          expect(instance.exists(match[1])).toBe(true);
        }
        expect(typeof value).toBe('string');
      }
    }
  });
});
