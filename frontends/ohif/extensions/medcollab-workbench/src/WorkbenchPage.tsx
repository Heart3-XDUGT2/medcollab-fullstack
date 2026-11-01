import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import CaseDetailPanel from './components/CaseDetailPanel';
import CaseList from './components/CaseList';
import DivisionModeSwitch from './components/DivisionModeSwitch';
import WorkbenchFilters from './components/WorkbenchFilters';
import WorkbenchHeader from './components/WorkbenchHeader';
import { DEMO_CURRENT_USER, MOCK_CASES } from './data/mockCases';
import type {
  AnnotationWorkspaceServiceLike,
  DivisionMode,
  OpenCaseError,
  OpenCaseState,
  OpenIntent,
  WorkbenchCase,
  WorkbenchFilter,
  WorkbenchPageProps,
  WorkbenchServicesManager,
} from './types';

const DEMO_NAV_NOTE = '演示导航：未接后端，不代表保存成功';

function getAnnotationWorkspaceService(
  servicesManager?: WorkbenchServicesManager
): AnnotationWorkspaceServiceLike | undefined {
  const candidate = servicesManager?.services?.annotationWorkspaceService;

  if (candidate && typeof candidate.openCase === 'function') {
    return candidate;
  }

  return undefined;
}

function hasSourceUID(caseRecord: WorkbenchCase) {
  return Boolean(caseRecord.studyInstanceUID) && Boolean(caseRecord.seriesInstanceUID);
}

function toOpenError(error: unknown): OpenCaseError {
  if (error && typeof error === 'object') {
    const maybeError = error as { code?: unknown; message?: unknown; name?: unknown };
    const code =
      typeof maybeError.code === 'string' && maybeError.code
        ? maybeError.code
        : typeof maybeError.name === 'string' && maybeError.name
          ? maybeError.name
          : 'OPEN_CASE_FAILED';
    const message =
      typeof maybeError.message === 'string' && maybeError.message
        ? maybeError.message
        : '打开病例失败，未返回可读错误信息。';

    return { code, message };
  }

  return {
    code: 'OPEN_CASE_FAILED',
    message: typeof error === 'string' && error ? error : '打开病例失败（未知错误）。',
  };
}

function matchesFilter(caseRecord: WorkbenchCase, filter: WorkbenchFilter) {
  switch (filter) {
    case 'mine':
      return caseRecord.owner.id === DEMO_CURRENT_USER.id;
    case 'shared':
      return (
        caseRecord.owner.id !== DEMO_CURRENT_USER.id &&
        caseRecord.collaborators.some(collaborator => collaborator.id === DEMO_CURRENT_USER.id)
      );
    case 'review':
      return caseRecord.status === 'review';
    case 'all':
    default:
      return true;
  }
}

function WorkbenchPage({ servicesManager }: WorkbenchPageProps) {
  const navigate = useNavigate();
  const [divisionMode, setDivisionMode] = useState<DivisionMode>('case');
  const [filter, setFilter] = useState<WorkbenchFilter>('all');
  const [search, setSearch] = useState('');
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(
    MOCK_CASES[0]?.caseId ?? null
  );
  const [lastRefreshed, setLastRefreshed] = useState('页面载入时的本地 mock 数据');
  const [refreshNote, setRefreshNote] = useState('');
  const [openState, setOpenState] = useState<OpenCaseState | null>(null);

  const searchedCases = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) {
      return MOCK_CASES;
    }
    return MOCK_CASES.filter(
      caseRecord =>
        caseRecord.caseId.toLowerCase().includes(keyword) ||
        caseRecord.name.toLowerCase().includes(keyword)
    );
  }, [search]);

  const counts = useMemo<Record<WorkbenchFilter, number>>(
    () => ({
      all: searchedCases.length,
      mine: searchedCases.filter(item => matchesFilter(item, 'mine')).length,
      shared: searchedCases.filter(item => matchesFilter(item, 'shared')).length,
      review: searchedCases.filter(item => matchesFilter(item, 'review')).length,
    }),
    [searchedCases]
  );

  const visibleCases = useMemo(
    () => searchedCases.filter(item => matchesFilter(item, filter)),
    [searchedCases, filter]
  );

  const activeCase =
    visibleCases.find(caseRecord => caseRecord.caseId === selectedCaseId) ??
    visibleCases[0] ??
    null;

  const handleRefresh = () => {
    setLastRefreshed(new Date().toLocaleTimeString('zh-CN', { hour12: false }));
    setRefreshNote('已从本地演示数据重新载入（未请求后端）');
  };

  const handleOpenCase = async (intent: OpenIntent) => {
    if (!activeCase) {
      return;
    }

    const caseId = activeCase.caseId;

    if (!hasSourceUID(activeCase) && !activeCase.backendCaseId) {
      setOpenState({
        caseId,
        intent,
        error: {
          code: 'MISSING_SOURCE_UID',
          message: '该演示病例没有 Study/Series UID，也没有后端 case ID，无法打开影像。',
        },
      });
      return;
    }

    const workspaceService = getAnnotationWorkspaceService(servicesManager);

    if (workspaceService?.openCase && activeCase.backendCaseId) {
      try {
        await workspaceService.openCase({
          caseId: activeCase.backendCaseId,
          intent,
          locale: 'zh',
        });
        setOpenState({
          caseId,
          intent,
          note: '已调用 annotationWorkspaceService.openCase；演示环境未验证后端落库，也不代表已保存/发布。',
        });
      } catch (error) {
        setOpenState({ caseId, intent, error: toOpenError(error) });
      }
      return;
    }

    const query = new URLSearchParams({
      StudyInstanceUIDs: activeCase.studyInstanceUID,
      SeriesInstanceUIDs: activeCase.seriesInstanceUID,
      lng: 'zh',
    });

    setOpenState({ caseId, intent, note: DEMO_NAV_NOTE });
    navigate(`/medcollab?${query.toString()}`);
  };

  return (
    <div
      data-testid="workbench-page"
      className="bg-background text-foreground flex min-h-screen w-full flex-col overflow-x-hidden"
    >
      <WorkbenchHeader
        user={DEMO_CURRENT_USER}
        caseCount={MOCK_CASES.length}
        lastRefreshed={lastRefreshed}
        refreshNote={refreshNote}
        onRefresh={handleRefresh}
      />

      <main className="mx-auto flex w-full min-w-0 max-w-[1600px] flex-1 flex-col gap-3 px-4 py-4">
        <DivisionModeSwitch
          value={divisionMode}
          onChange={setDivisionMode}
        />

        <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
          <div className="flex min-w-0 flex-col gap-3">
            <WorkbenchFilters
              filter={filter}
              counts={counts}
              search={search}
              onFilterChange={setFilter}
              onSearchChange={setSearch}
            />
            <CaseList
              cases={visibleCases}
              selectedCaseId={activeCase?.caseId ?? null}
              focusedDivision={divisionMode}
              onSelectCase={setSelectedCaseId}
            />
          </div>

          <CaseDetailPanel
            caseRecord={activeCase}
            focusedDivision={divisionMode}
            currentUser={DEMO_CURRENT_USER}
            openState={openState}
            onOpen={handleOpenCase}
          />
        </div>

        <p className="text-muted-foreground/60 text-xxs">
          本页所有病例、协作者与版本均来自本地 mock
          数据；没有发送保存/发布请求。影像打开只是页面跳转。
        </p>
      </main>
    </div>
  );
}

export default WorkbenchPage;
