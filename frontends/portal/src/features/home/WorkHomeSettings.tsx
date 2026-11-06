import { useEffect, useState } from 'react';
import { Trigger } from '@radix-ui/react-dialog';
import { ArrowDown, ArrowUp, RotateCcw, Settings2 } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../ui';
import type { HomePreferencesModel } from './preferences/useHomePreferences';
import { DEFAULT_HOME_COMPOSITION, HOME_MODULE_LABELS, homeModuleGroups } from './preferences/model';
import type { HomeEntry, HomeModule } from './preferences/model';

export default function WorkHomeSettings({ model }: { model: HomePreferencesModel }) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    setOpen(false);
    setNotice('');
  }, [model.update]);
  const values = model.preferences.home;
  const groups = homeModuleGroups(values, true);
  function move(module: HomeModule, direction: number) {
    const order = [...values.order];
    const lane: readonly HomeModule[] = module === 'continue' || module === 'library' ? groups.primary : groups.reference;
    const neighbor = lane[lane.indexOf(module) + direction];
    if (!neighbor) return;
    const index = order.indexOf(module), next = order.indexOf(neighbor);
    [order[index], order[next]] = [order[next], order[index]];
    model.update({ home: { ...values, order } });
    setNotice(`${HOME_MODULE_LABELS[module]}已${direction < 0 ? '上移' : '下移'}。`);
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Trigger asChild>
        <Button
          variant="ghost"
          size="icon"
          title="首页设置"
          aria-label="首页设置"
          dataCY="work-home-settings"
        >
          <Settings2 size={18} />
        </Button>
      </Trigger>
      <DialogContent
        className="mc-library-dialog mc-work-settings"
        data-cy="work-home-settings-panel"
      >
        <DialogHeader>
          <DialogTitle>首页设置</DialogTitle>
          <DialogDescription>
            {model.scope === 'account'
              ? '仅本人 · 此浏览器。'
              : model.scope === 'demo'
                ? '演示 · 当前页面。'
                : '匿名 · 当前页面。'}
            不改变资料、收藏或团队权限。
          </DialogDescription>
        </DialogHeader>
        <label className="mc-work-default-entry">
          <span>默认进入</span>
          <select
            aria-label="默认进入"
            value={values.defaultEntry}
            onChange={(event) =>
              model.update({ home: { ...values, defaultEntry: event.target.value as HomeEntry } })
            }
          >
            <option value="work">工作首页</option>
            <option value="library">完整资料库</option>
          </select>
        </label>
        {([['主要内容', groups.primary], ['参考信息', groups.reference]] as const).map(([label, modules]) => <fieldset key={label} className="mc-work-module-settings">
          <legend>{label}</legend>
          {modules.map((module, index) => (
            <div key={module}>
              <label>
                <input
                  type="checkbox"
                  checked={!values.hidden.includes(module)}
                  onChange={(event) =>
                    model.update({
                      home: {
                        ...values,
                        hidden: event.target.checked
                          ? values.hidden.filter((item) => item !== module)
                          : [...values.hidden, module],
                      },
                    })
                  }
                />
                {HOME_MODULE_LABELS[module]}
              </label>
              <Button
                variant="ghost"
                size="icon"
                disabled={index === 0}
                title={`上移${HOME_MODULE_LABELS[module]}`}
                aria-label={`上移${HOME_MODULE_LABELS[module]}`}
                onClick={() => move(module, -1)}
              >
                <ArrowUp size={16} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                disabled={index === modules.length - 1}
                title={`下移${HOME_MODULE_LABELS[module]}`}
                aria-label={`下移${HOME_MODULE_LABELS[module]}`}
                onClick={() => move(module, 1)}
              >
                <ArrowDown size={16} />
              </Button>
            </div>
          ))}
        </fieldset>)}
        <p className="mc-work-settings-status" role="status">
          {model.persistence === 'unavailable'
            ? '浏览器未能保存本次更改，刷新后可能恢复旧设置。'
            : model.persistence === 'loading'
              ? '正在读取本机偏好…'
              : model.scope === 'demo'
                ? '演示设置刷新或退出后丢弃。'
                : notice}
        </p>
        <Button
          variant="ghost"
          onClick={() => {
            model.update({ home: DEFAULT_HOME_COMPOSITION });
            setNotice('已恢复首页默认，资料库显示偏好保持不变。');
          }}
        >
          <RotateCcw size={15} />
          恢复首页默认
        </Button>
      </DialogContent>
    </Dialog>
  );
}
