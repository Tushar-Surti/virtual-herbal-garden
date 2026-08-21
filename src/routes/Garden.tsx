import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { gardenBeds, getPlant, plants, type GardenBed } from '../data/plants'
import { tours } from '../data/tours'
import { GardenScene, OVERVIEW, type CameraGoal } from '../three/GardenScene'
import { BotanicalPlate } from '../components/BotanicalPlate'
import { Icon } from '../components/ui/Icon'
import { Badge, Button, cx } from '../components/ui/primitives'
import { useGarden } from '../store/useGarden'
import { useGardenLayout } from '../three/GardenScene'

export default function Garden() {
  const [params, setParams] = useSearchParams()
  const [goal, setGoal] = useState<CameraGoal>(OVERVIEW)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [activeBed, setActiveBed] = useState<string | null>(null)
  const [showIntro, setShowIntro] = useState(true)
  const [showLabels, setShowLabels] = useState(true)
  const [walkMode, setWalkMode] = useState(false)
  // Plant id currently under the walk-mode crosshair
  const [walkNearby, setWalkNearby] = useState<string | null>(null)
  // Plant selected while walking (shows the detail panel)
  const [walkSelected, setWalkSelected] = useState<string | null>(null)
  // When true, pointer lock is released so UI elements can be clicked
  const [cursorFree, setCursorFree] = useState(false)

  const layout = useGardenLayout()
  const visited = useGarden((s) => s.visited)
  const bookmarks = useGarden((s) => s.bookmarks)
  const selected = getPlant(selectedId ?? undefined)
  const walkSelectedPlant = getPlant(walkSelected ?? undefined)

  // Tours this plant appears in
  const walkSelectedTours = useMemo(
    () => (walkSelected ? tours.filter((t) => t.stops.some((s) => s.plantId === walkSelected)) : []),
    [walkSelected],
  )

  // The narration stop for this plant in each tour
  const stopFor = useCallback(
    (tourId: string) => {
      const tour = tours.find((t) => t.id === tourId)
      return tour?.stops.find((s) => s.plantId === walkSelected) ?? null
    },
    [walkSelected],
  )

  const focusBed = useMemo(
    () => (bed: GardenBed) => {
      setActiveBed(bed.id)
      setSelectedId(null)
      setGoal({ target: [bed.position[0], 0.6, bed.position[1]], distance: 7.4, lift: 0.42 })
    },
    [],
  )

  const focusPlant = useMemo(
    () => (id: string) => {
      const placement = layout.find((p) => p.plant.id === id)
      if (!placement) return
      setSelectedId(id)
      setActiveBed(placement.bed.id)
      const height = placement.plant.model.height * placement.scale
      setGoal({
        target: [placement.position[0], Math.max(0.35, height * 0.5), placement.position[2]],
        distance: Math.max(1.9, height * 2.5),
        lift: 0.4,
      })
    },
    [layout],
  )

  // Called when player selects a plant while walking
  const onWalkSelect = useCallback((id: string) => {
    useGarden.getState().markVisited(id)
    setWalkSelected(id)
    setCursorFree(true)   // Auto-free cursor so the panel is clickable
  }, [])

  const toggleCursor = useCallback(() => setCursorFree((v) => !v), [])

  // Deep link: /?bed=mind focuses that bed on arrival.
  useEffect(() => {
    const bedId = params.get('bed')
    if (!bedId) return
    const bed = gardenBeds.find((b) => b.id === bedId)
    if (bed) {
      focusBed(bed)
      setShowIntro(false)
    }
    params.delete('bed')
    setParams(params, { replace: true })
  }, [params, setParams, focusBed])

  const goOverview = () => {
    setActiveBed(null)
    setSelectedId(null)
    setGoal({ ...OVERVIEW })
  }

  // F key toggles walk mode globally
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.code === 'KeyF') setWalkMode((v) => !v)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // When entering walk mode, dismiss selected panel and close intro
  useEffect(() => {
    if (walkMode) {
      setSelectedId(null)
      setShowIntro(false)
      setWalkSelected(null)
      setCursorFree(false)
    } else {
      // Exiting walk mode: clear walk state
      setWalkNearby(null)
      setWalkSelected(null)
      setCursorFree(false)
    }
  }, [walkMode])

  const idleSpin = !selectedId && !activeBed && showIntro && !walkMode

  return (
    <div className="relative h-full w-full overflow-hidden">
      <GardenScene
        goal={goal}
        selectedId={selectedId}
        hoveredId={hoveredId}
        onHover={setHoveredId}
        onSelect={focusPlant}
        onSelectBed={focusBed}
        idleSpin={idleSpin}
        showLabels={showLabels && !selectedId && !walkMode}
        walkMode={walkMode}
        onExitWalk={() => setWalkMode(false)}
        walkNearby={walkNearby}
        onWalkNearby={setWalkNearby}
        onWalkSelect={onWalkSelect}
        cursorFree={cursorFree}
        onToggleCursor={toggleCursor}
      />

      {/* Crosshair — only while walking and cursor is locked */}
      {walkMode && !cursorFree && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div
            className="relative flex items-center justify-center"
            style={{ width: 28, height: 28 }}
          >
            {/* Outer ring pulses when a plant is aimed at */}
            <div
              className="absolute rounded-full border-2 transition-all duration-150"
              style={{
                width: walkNearby ? 26 : 18,
                height: walkNearby ? 26 : 18,
                borderColor: walkNearby ? '#ffffff' : 'rgba(255,255,255,0.5)',
              }}
            />
            {/* Centre dot */}
            <div
              className="rounded-full transition-all duration-150"
              style={{
                width: walkNearby ? 5 : 3,
                height: walkNearby ? 5 : 3,
                background: walkNearby ? '#fff' : 'rgba(255,255,255,0.7)',
              }}
            />
          </div>
        </div>
      )}

      {/* ---------------- Intro card ---------------- */}
      {showIntro && (
        <div className="animate-fade-up pointer-events-none absolute inset-x-0 top-0 flex justify-center p-4 sm:justify-start sm:p-6">
          <div className="glass pointer-events-auto max-w-sm rounded-3xl border border-line p-5 shadow-[var(--shadow-lift)]">
            <p className="text-[0.68rem] font-semibold tracking-[0.2em] text-accent uppercase">Welcome</p>
            <h1 className="mt-1.5 font-display text-[1.6rem] leading-tight font-semibold tracking-[-0.02em]">
              A herbal garden you can walk through
            </h1>
            <p className="mt-2 text-[0.87rem] leading-relaxed text-ink-soft text-balance-pretty">
              Twenty-five AYUSH medicinal plants, grown here from botanical descriptions rather than downloaded
              models. Drag to look around, click any plant to meet it, or take a themed walk.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="primary" size="sm" onClick={() => setShowIntro(false)} icon="compass">
                Explore freely
              </Button>
              <Link to={`/tours/${tours[0].id}`}>
                <Button variant="secondary" size="sm" icon="route">
                  Take the intro tour
                </Button>
              </Link>
            </div>
            <div className="mt-4 flex items-center gap-4 border-t border-line pt-3 text-[0.72rem] text-ink-faint">
              <span>{plants.length} plants</span>
              <span>{gardenBeds.length} themed beds</span>
              <span>{tours.length} tours</span>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- Bed navigator (hidden in walk mode) ---------------- */}
      {!walkMode && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 p-3 pb-19 sm:p-5 md:pb-5">
          <div className="scrollbar-none pointer-events-auto mx-auto flex max-w-full items-center gap-2 overflow-x-auto pb-1">
            <button
              onClick={goOverview}
              className={cx(
                'glass flex shrink-0 items-center gap-1.5 rounded-full border border-line px-3.5 py-2 text-[0.8rem] font-medium transition-colors',
                !activeBed ? 'text-ink' : 'text-ink-faint hover:text-ink-soft',
              )}
            >
              <Icon name="map" size={15} />
              Whole garden
            </button>
            {gardenBeds.map((bed) => {
              const seen = bed.plantIds.filter((id) => visited.includes(id)).length
              return (
                <button
                  key={bed.id}
                  onClick={() => focusBed(bed)}
                  className={cx(
                    'glass flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-2 text-[0.8rem] font-medium whitespace-nowrap transition-all',
                    activeBed === bed.id ? 'border-transparent text-white' : 'border-line text-ink-soft hover:text-ink',
                  )}
                  style={activeBed === bed.id ? { background: bed.accent } : undefined}
                >
                  <span className="size-2 rounded-full" style={{ background: bed.accent }} />
                  {bed.name}
                  <span className={cx('text-[0.7rem] tabular-nums', activeBed === bed.id ? 'opacity-75' : 'text-ink-faint')}>
                    {seen}/{bed.plantIds.length}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* ---------------- Selected plant panel (orbit mode) ---------------- */}
      {selected && !walkMode && (
        <aside className="animate-fade-up absolute inset-x-3 bottom-36 z-20 md:inset-x-auto md:top-6 md:right-6 md:bottom-auto md:w-[22rem]">
          <div className="glass overflow-hidden rounded-3xl border border-line shadow-[var(--shadow-lift)]">
            <div className="flex items-start gap-3 p-4">
              <span
                className="grid size-16 shrink-0 place-items-center rounded-2xl"
                style={{ background: `color-mix(in srgb, ${selected.accent} 16%, transparent)` }}
              >
                <BotanicalPlate plant={selected} className="size-14" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="font-display text-lg leading-tight font-semibold">{selected.name}</h2>
                <p className="truncate text-[0.76rem] text-ink-faint italic">{selected.botanical}</p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {selected.therapeutic.slice(0, 2).map((t) => (
                    <Badge key={t} tone={selected.accent}>
                      {t}
                    </Badge>
                  ))}
                </div>
              </div>
              <button
                onClick={() => {
                  setSelectedId(null)
                  const bed = gardenBeds.find((b) => b.id === activeBed)
                  if (bed) focusBed(bed)
                  else goOverview()
                }}
                aria-label="Close"
                className="text-ink-faint transition-colors hover:text-ink"
              >
                <Icon name="close" size={17} />
              </button>
            </div>

            <p className="px-4 pb-3 text-[0.85rem] leading-relaxed text-ink-soft text-balance-pretty">
              {selected.tagline}
            </p>

            <dl className="grid grid-cols-2 gap-px border-y border-line bg-line">
              <div className="bg-[var(--surface-raised)] px-4 py-2.5">
                <dt className="text-[0.62rem] tracking-[0.1em] text-ink-faint uppercase">Parts used</dt>
                <dd className="truncate text-[0.82rem]">{selected.partsUsed.slice(0, 2).join(', ')}</dd>
              </div>
              <div className="bg-[var(--surface-raised)] px-4 py-2.5">
                <dt className="text-[0.62rem] tracking-[0.1em] text-ink-faint uppercase">Potency</dt>
                <dd className="truncate text-[0.82rem]">{selected.ayurvedic.virya}</dd>
              </div>
            </dl>

            <div className="flex items-center gap-2 p-3">
              <Link to={`/plant/${selected.id}`} className="flex-1">
                <Button variant="primary" size="sm" className="w-full" iconRight="arrowRight">
                  Full entry
                </Button>
              </Link>
              <Button
                variant="secondary"
                size="sm"
                icon="bookmark"
                solidIcon={bookmarks.includes(selected.id)}
                onClick={() => useGarden.getState().toggleBookmark(selected.id)}
                aria-label="Save to My Garden"
              />
            </div>
          </div>
        </aside>
      )}

      {/* ---------------- Walk-mode plant detail panel ---------------- */}
      {walkMode && walkSelectedPlant && (
        <aside
          className="animate-fade-up absolute top-4 right-16 z-20 flex w-[20rem] flex-col sm:top-6 sm:right-20"
          style={{ maxHeight: 'calc(100vh - 5.5rem)' }}
        >
          <div className="glass flex flex-col overflow-hidden rounded-3xl border border-line shadow-[var(--shadow-lift)]">

            {/* ── Pinned header ── */}
            <div className="flex shrink-0 items-start gap-3 p-4">
              <span
                className="grid size-14 shrink-0 place-items-center rounded-2xl"
                style={{ background: `color-mix(in srgb, ${walkSelectedPlant.accent} 16%, transparent)` }}
              >
                <BotanicalPlate plant={walkSelectedPlant} className="size-12" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="font-display text-base leading-tight font-semibold">{walkSelectedPlant.name}</h2>
                <p className="truncate text-[0.73rem] text-ink-faint italic">{walkSelectedPlant.botanical}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {walkSelectedPlant.therapeutic.slice(0, 2).map((t) => (
                    <Badge key={t} tone={walkSelectedPlant.accent}>{t}</Badge>
                  ))}
                  {walkSelectedPlant.therapeutic.length > 2 && (
                    <span className="text-[0.65rem] text-ink-faint self-center">+{walkSelectedPlant.therapeutic.length - 2}</span>
                  )}
                </div>
              </div>
              <button
                onClick={() => setWalkSelected(null)}
                aria-label="Close"
                className="shrink-0 text-ink-faint transition-colors hover:text-ink"
              >
                <Icon name="close" size={16} />
              </button>
            </div>

            {/* ── Scrollable body ── */}
            <div className="scrollbar-none flex-1 overflow-y-auto">

              {/* Tagline */}
              <p className="px-4 pb-3 text-[0.82rem] leading-relaxed text-ink-soft">
                {walkSelectedPlant.tagline}
              </p>

              {/* Key facts */}
              <dl className="grid grid-cols-2 gap-px border-y border-line bg-line">
                <div className="bg-[var(--surface-raised)] px-4 py-2">
                  <dt className="text-[0.6rem] tracking-[0.1em] text-ink-faint uppercase">Parts used</dt>
                  <dd className="truncate text-[0.78rem]">{walkSelectedPlant.partsUsed.slice(0, 2).join(', ')}</dd>
                </div>
                <div className="bg-[var(--surface-raised)] px-4 py-2">
                  <dt className="text-[0.6rem] tracking-[0.1em] text-ink-faint uppercase">Potency</dt>
                  <dd className="truncate text-[0.78rem]">{walkSelectedPlant.ayurvedic.virya}</dd>
                </div>
                <div className="bg-[var(--surface-raised)] px-4 py-2">
                  <dt className="text-[0.6rem] tracking-[0.1em] text-ink-faint uppercase">Rasa</dt>
                  <dd className="truncate text-[0.78rem]">{walkSelectedPlant.ayurvedic.rasa.join(', ')}</dd>
                </div>
                <div className="bg-[var(--surface-raised)] px-4 py-2">
                  <dt className="text-[0.6rem] tracking-[0.1em] text-ink-faint uppercase">Conservation</dt>
                  <dd className="truncate text-[0.78rem]">{walkSelectedPlant.conservation}</dd>
                </div>
              </dl>

              {/* Top medicinal use (just 1 to keep it tight) */}
              {walkSelectedPlant.uses[0] && (
                <div className="border-b border-line px-4 py-3">
                  <p className="mb-1 text-[0.6rem] font-semibold tracking-[0.12em] text-ink-faint uppercase">
                    Key use
                  </p>
                  <p className="text-[0.78rem] font-medium text-ink">{walkSelectedPlant.uses[0].title}</p>
                  <p className="mt-0.5 text-[0.72rem] leading-snug text-ink-soft line-clamp-2">
                    {walkSelectedPlant.uses[0].detail}
                  </p>
                </div>
              )}

              {/* Tours */}
              {walkSelectedTours.length > 0 && (
                <div className="px-4 py-3">
                  <p className="mb-2 text-[0.6rem] font-semibold tracking-[0.12em] text-ink-faint uppercase">
                    In {walkSelectedTours.length} tour{walkSelectedTours.length > 1 ? 's' : ''}
                  </p>
                  <div className="space-y-2">
                    {walkSelectedTours.map((tour) => (
                      <Link
                        key={tour.id}
                        to={`/tours/${tour.id}`}
                        className="flex items-center gap-2.5 rounded-2xl p-2.5 transition-opacity hover:opacity-80"
                        style={{ background: `color-mix(in srgb, ${tour.accent} 12%, transparent)` }}
                      >
                        <div
                          className="grid size-8 shrink-0 place-items-center rounded-full text-white"
                          style={{ background: tour.accent }}
                        >
                          <Icon name="route" size={13} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[0.78rem] font-semibold leading-tight">{tour.title}</p>
                          <p className="text-[0.68rem] text-ink-faint">{tour.minutes} min · {tour.subtitle}</p>
                        </div>
                        <Icon name="arrowRight" size={13} className="shrink-0 text-ink-faint" />
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* ── Pinned footer ── */}
            <div className="flex shrink-0 items-center gap-2 border-t border-line p-3">
              <Link to={`/plant/${walkSelectedPlant.id}`} className="flex-1">
                <Button variant="primary" size="sm" className="w-full" iconRight="arrowRight">
                  Full entry
                </Button>
              </Link>
              <Button
                variant="secondary"
                size="sm"
                icon="bookmark"
                solidIcon={bookmarks.includes(walkSelectedPlant.id)}
                onClick={() => useGarden.getState().toggleBookmark(walkSelectedPlant.id)}
                aria-label="Save to My Garden"
              />
            </div>
          </div>
        </aside>
      )}


      {/* ---------------- Utility controls ---------------- */}
      <div className="absolute top-4 right-4 flex flex-col gap-2 sm:top-6 sm:right-6">
        {/* Walk mode toggle button */}
        <button
          onClick={() => setWalkMode((v) => !v)}
          aria-pressed={walkMode}
          title={walkMode ? 'Exit walk mode (F)' : 'Enter walk mode (F)'}
          className="glass grid size-10 place-items-center rounded-full border transition-colors"
          style={walkMode
            ? { background: '#059669', borderColor: 'transparent', color: '#fff' }
            : undefined}
        >
          {/* Walking person icon */}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="4" r="2" />
            <path d="M9 11l3-3 3 3" />
            <path d="M9 11v5l-2 4" />
            <path d="M15 11v5l2 4" />
          </svg>
        </button>
        {!selected && !walkMode && (
          <button
            onClick={() => setShowLabels((v) => !v)}
            aria-pressed={showLabels}
            title="Toggle bed signs"
            className="glass grid size-10 place-items-center rounded-full border border-line text-ink-soft transition-colors hover:text-ink"
          >
            <Icon name={showLabels ? 'eye' : 'layers'} size={17} />
          </button>
        )}
      </div>

      {/* ---------------- Walk mode HUD hint ---------------- */}
      {walkMode && (
        <div className="pointer-events-none absolute inset-x-0 bottom-6 flex flex-col items-center gap-2">
          {/* Cursor-mode toggle pill */}
          <button
            className="pointer-events-auto flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[0.75rem] font-medium shadow-lg backdrop-blur-sm transition-all"
            style={cursorFree
              ? { background: '#059669', borderColor: 'transparent', color: '#fff' }
              : { background: 'rgba(0,0,0,0.55)', borderColor: 'rgba(255,255,255,0.18)', color: 'rgba(255,255,255,0.85)' }}
            onClick={toggleCursor}
            title="Toggle cursor (Tab)"
          >
            {cursorFree ? (
              <>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M4 4l7.07 17 2.51-7.39L21 11.07z"/></svg>
                Cursor — click to lock
              </>
            ) : (
              <>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="3"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/></svg>
                Walking — click to free cursor
              </>
            )}
          </button>

          <p className="glass rounded-full border border-line/60 px-4 py-2 text-[0.74rem] text-ink-soft">
            {cursorFree ? (
              <><span className="font-mono font-semibold text-ink">Tab / Esc</span> re-lock &nbsp;·&nbsp; <span className="font-mono font-semibold text-ink">F</span> exit walk</>
            ) : (
              <><span className="font-mono font-semibold text-ink">W A S D</span> move &nbsp;·&nbsp; <span className="font-mono font-semibold text-ink">E</span> inspect &nbsp;·&nbsp; <span className="font-mono font-semibold text-ink">Tab</span> cursor &nbsp;·&nbsp; <span className="font-mono font-semibold text-ink">Esc</span> exit</>
            )}
          </p>
          {!walkSelected && !cursorFree && (
            <p className="text-[0.68rem] text-ink-faint">
              {walkNearby ? 'Press E or click to inspect this plant' : 'Click the scene to lock mouse & walk'}
            </p>
          )}
        </div>
      )}

      {!showIntro && !selected && !walkMode && (
        <p className="glass pointer-events-none absolute top-4 left-1/2 -translate-x-1/2 rounded-full border border-line px-3.5 py-1.5 text-[0.74rem] text-ink-faint sm:top-6">
          Click a plant to meet it · drag to look around
        </p>
      )}
    </div>
  )
}
