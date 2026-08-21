import { Suspense, useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Html, OrbitControls } from '@react-three/drei'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { BED_RADIUS, gardenBeds, plantById, type GardenBed } from '../data/plants'
import type { Plant } from '../types/plant'
import { PlantObject } from './PlantObject'
import { tickWind } from './materials'
import { GARDEN_EXTENT, gardenFloorTexture } from './gardenTexture'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { buildLeafGeometry } from './procedural/leaf'
import type { Detail } from './procedural/plant'
import { hashSeed, makeRng } from './procedural/rng'
import { useDetail, dprFor } from '../hooks/useDetail'
import { useGarden } from '../store/useGarden'
import { FirstPersonWalker } from './FirstPersonWalker'

/* ------------------------------------------------------------------ *
 * The garden: six themed beds arranged around a central plaza, every
 * plant generated at run time. Camera focus is damped rather than
 * cut, so moving between beds reads as walking, not teleporting.
 * ------------------------------------------------------------------ */

export interface Placement {
  plant: Plant
  bed: GardenBed
  position: [number, number, number]
  spin: number
  scale: number
}

/** Lays each bed out as a ring with the tallest specimen at the back. */
export function useGardenLayout(): Placement[] {
  return useMemo(() => {
    const placements: Placement[] = []
    for (const bed of gardenBeds) {
      const rng = makeRng(hashSeed(bed.id))
      const members = bed.plantIds
        .map((id) => plantById.get(id))
        .filter((p): p is Plant => Boolean(p))
        .sort((a, b) => b.model.height - a.model.height)

      members.forEach((plant, i) => {
        // Tallest goes to the middle-back; the rest fan out toward the path.
        const angle =
          i === 0 ? Math.PI * 1.5 : Math.PI * 0.5 + ((i - 0.5) / (members.length - 1) - 0.5) * Math.PI * 1.25
        const ring = i === 0 ? BED_RADIUS * 0.34 : BED_RADIUS * 0.62
        const x = bed.position[0] + Math.cos(angle) * ring + rng.jitter(0.16)
        const z = bed.position[1] + Math.sin(angle) * ring + rng.jitter(0.16)
        // Everything is nudged up for presence, and ground-hugging creepers
        // get a further lift so they stay legible beside a young tree.
        const scale = 1.5 * THREE.MathUtils.clamp(0.5 / plant.model.height, 1, 2.9)
        placements.push({
          plant,
          bed,
          position: [x, 0, z],
          spin: rng.range(0, Math.PI * 2),
          scale,
        })
      })
    }
    return placements
  }, [])
}

function WindClock({ strength }: { strength: number }) {
  useFrame(({ clock }) => tickWind(clock.elapsedTime, strength))
  return null
}

/* --------------------------- camera rig --------------------------- */

export interface CameraGoal {
  target: [number, number, number]
  distance: number
  /** Height of the eye above the target, as a fraction of distance. */
  lift?: number
  /** Compass bearing in radians; undefined keeps the current bearing. */
  bearing?: number
}

export const OVERVIEW: CameraGoal = { target: [0, 0.9, 0], distance: 23, lift: 0.38, bearing: Math.PI * 0.5 }

function CameraRig({
  goal,
  controls,
  idleSpin,
}: {
  goal: CameraGoal
  controls: React.RefObject<OrbitControlsImpl | null>
  idleSpin: boolean
}) {
  const { camera, size } = useThree()
  const desiredTarget = useRef(new THREE.Vector3(...OVERVIEW.target))
  const flyTo = useRef<THREE.Vector3 | null>(null)
  // A portrait viewport sees far less of the garden at a given distance.
  const aspect = size.width / Math.max(1, size.height)
  const reachScale = THREE.MathUtils.clamp(1.5 / Math.max(0.35, aspect), 1, 2.1)

  useEffect(() => {
    desiredTarget.current.set(...goal.target)

    // Aim from the plaza outward so the visitor always faces the bed.
    const outward = new THREE.Vector2(goal.target[0], goal.target[2])
    const bearing =
      goal.bearing ?? (outward.lengthSq() > 0.5 ? Math.atan2(outward.y, outward.x) : Math.PI * 0.5)
    const lift = goal.lift ?? 0.42
    const reach = goal.distance * reachScale
    const eye = new THREE.Vector3(
      goal.target[0] + Math.cos(bearing) * reach,
      goal.target[1] + reach * lift,
      goal.target[2] + Math.sin(bearing) * reach,
    )
    // The frame loop eases toward this rather than cutting to it.
    flyTo.current = eye
  }, [goal, reachScale])

  useFrame((_, delta) => {
    const ctrl = controls.current
    if (!ctrl) return
    const destination = flyTo.current
    if (destination) {
      camera.position.x = THREE.MathUtils.damp(camera.position.x, destination.x, 2.6, delta)
      camera.position.y = THREE.MathUtils.damp(camera.position.y, destination.y, 2.6, delta)
      camera.position.z = THREE.MathUtils.damp(camera.position.z, destination.z, 2.6, delta)
      if (camera.position.distanceToSquared(destination) < 0.004) flyTo.current = null
    }
    ctrl.target.x = THREE.MathUtils.damp(ctrl.target.x, desiredTarget.current.x, 3, delta)
    ctrl.target.y = THREE.MathUtils.damp(ctrl.target.y, desiredTarget.current.y, 3, delta)
    ctrl.target.z = THREE.MathUtils.damp(ctrl.target.z, desiredTarget.current.z, 3, delta)
  })

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enablePan={false}
      enableDamping
      dampingFactor={0.05}
      autoRotate={idleSpin}
      autoRotateSpeed={0.18}
      minDistance={1.6}
      maxDistance={34}
      minPolarAngle={0.12}
      maxPolarAngle={Math.PI * 0.47}
    />
  )
}

/* ---------------------------- scenery ---------------------------- */

function Ground({ dark }: { dark: boolean }) {
  const texture = useMemo(() => gardenFloorTexture(dark), [dark])
  const horizon = dark ? '#101d18' : '#cfdbe4'
  return (
    <group>
      {/* Surrounding haze: the textured plan fades into this, which fades into fog. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.03, 0]}>
        <planeGeometry args={[110, 110, 1, 1]} />
        <meshBasicMaterial color={horizon} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[GARDEN_EXTENT * 2, GARDEN_EXTENT * 2, 1, 1]} />
        <meshStandardMaterial map={texture} roughness={1} metalness={0} />
      </mesh>
    </group>
  )
}

/** Raised stone kerb and soil for each themed bed. */
function BedPlinths({ dark }: { dark: boolean }) {
  return (
    <group>
      {gardenBeds.map((bed) => (
        <group key={bed.id} position={[bed.position[0], 0, bed.position[1]]}>
          <mesh position={[0, 0.055, 0]} receiveShadow castShadow>
            <cylinderGeometry args={[BED_RADIUS, BED_RADIUS + 0.06, 0.11, 40, 1]} />
            <meshStandardMaterial color={dark ? '#4d5044' : '#b3a98c'} roughness={0.92} />
          </mesh>
          <mesh position={[0, 0.115, 0]} receiveShadow>
            <cylinderGeometry args={[BED_RADIUS - 0.13, BED_RADIUS - 0.13, 0.02, 36, 1]} />
            <meshStandardMaterial color={dark ? '#3a2e1f' : '#5f4a31'} roughness={1} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

/** The plaza at the crossing of the paths, with a small water basin. */
function Plaza({ dark }: { dark: boolean }) {
  return (
    <group>
      <mesh position={[0, 0.03, 0]} receiveShadow>
        <cylinderGeometry args={[3.1, 3.15, 0.06, 48, 1]} />
        <meshStandardMaterial color={dark ? '#565b4b' : '#c8c0a6'} roughness={0.85} />
      </mesh>
      <mesh position={[0, 0.14, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.95, 1.08, 0.22, 32, 1]} />
        <meshStandardMaterial color={dark ? '#616754' : '#b6ad92'} roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.255, 0]}>
        <circleGeometry args={[0.86, 32]} />
        <meshStandardMaterial
          color={dark ? '#2d6070' : '#68a8bd'}
          roughness={0.05}
          metalness={0.25}
          transparent
          opacity={0.92}
        />
      </mesh>
    </group>
  )
}

/** One grass blade: wide at the base, pointed at the tip, arching over. */
function bladeGeometry(width: number, height: number, bend: number): THREE.BufferGeometry {
  const segments = 3
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    const halfWidth = width * (1 - t * 0.92) * 0.5
    const y = t * height
    const z = bend * height * t * t
    positions.push(-halfWidth, y, z, halfWidth, y, z)
    uvs.push(0, t, 1, t)
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 2
    // Both windings, so the blade is visible from either side while still
    // rendering as a front face — a DoubleSide material would flip the
    // normal on the far side and turn the tuft black.
    indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
    indices.push(a + 1, a + 2, a, a + 3, a + 2, a + 1)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geo.setIndex(indices)
  // Blades take the ground's normal rather than their own. A vertical card lit
  // by its true normal goes almost black; this is the standard foliage trick,
  // and it makes the tufts read as part of the lawn instead of objects on it.
  const upward = new Float32Array(positions.length)
  for (let i = 1; i < upward.length; i += 3) upward[i] = 1
  geo.setAttribute('normal', new THREE.BufferAttribute(upward, 3))
  return geo
}

/** A tuft of three crossed blades — the lawn's grass. */
function tuftGeometry(width: number, height: number): THREE.BufferGeometry {
  const blade = bladeGeometry(width, height, 0.35)
  const parts = [blade, blade.clone().rotateY(Math.PI / 3), blade.clone().rotateY(-Math.PI / 3)]
  const tuft = mergeGeometries(parts, false)!
  parts.forEach((part) => part.dispose())
  return tuft
}

/** A small leafy rosette — bed filler that reads as planting, not grass. */
function sproutGeometry(): THREE.BufferGeometry {
  const leaf = buildLeafGeometry({
    shape: 'ovate',
    length: 0.15,
    width: 0.082,
    droop: 0.42,
    curl: 0.35,
    rows: 3,
    cols: 2,
  })
  const golden = Math.PI * (3 - Math.sqrt(5))
  const parts: THREE.BufferGeometry[] = []
  for (let i = 0; i < 6; i++) {
    const angle = i * golden
    const lean = 0.55 + (i / 6) * 0.6
    const dir = new THREE.Vector3(Math.cos(angle) * lean, 0.72, Math.sin(angle) * lean).normalize()
    const g = leaf.clone()
    g.applyMatrix4(
      new THREE.Matrix4().makeRotationFromQuaternion(
        new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir),
      ),
    )
    parts.push(g)
  }
  leaf.dispose()
  const sprout = mergeGeometries(parts, false)!
  parts.forEach((part) => part.dispose())

  // Half-way to the same trick: keep enough of the real normal to show form,
  // but lift it toward the sky so the filler does not read as dark clutter.
  const normals = sprout.attributes.normal
  const up = new THREE.Vector3(0, 1, 0)
  const n = new THREE.Vector3()
  for (let i = 0; i < normals.count; i++) {
    n.fromBufferAttribute(normals, i).lerp(up, 0.55).normalize()
    normals.setXYZ(i, n.x, n.y, n.z)
  }
  normals.needsUpdate = true
  return sprout
}

/**
 * Low planting that fills the soil between specimens. A real herb bed is
 * dense; without this the beds read as bare earth with a few twigs in it.
 */
function BedUndergrowth({ dark, perBed }: { dark: boolean; perBed: number }) {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const geometry = useMemo(() => sproutGeometry(), [])
  const total = perBed * gardenBeds.length
  const placements = useGardenLayout()

  useEffect(() => {
    const instanced = mesh.current
    if (!instanced) return
    const rng = makeRng(90210)
    const matrix = new THREE.Matrix4()
    const colour = new THREE.Color()
    const tint = new THREE.Color()
    let placed = 0

    for (const bed of gardenBeds) {
      tint.set(bed.accent)
      const occupied = placements.filter((p) => p.bed.id === bed.id)
      let attempts = 0
      let inBed = 0
      while (inBed < perBed && attempts < perBed * 10) {
        attempts++
        const angle = rng.next() * Math.PI * 2
        const radius = Math.sqrt(rng.next()) * (BED_RADIUS - 0.3)
        const x = bed.position[0] + Math.cos(angle) * radius
        const z = bed.position[1] + Math.sin(angle) * radius
        // Leave breathing room around each specimen.
        if (occupied.some((o) => Math.hypot(x - o.position[0], z - o.position[2]) < 0.34)) continue

        const scale = rng.range(0.55, 1.25)
        matrix.compose(
          new THREE.Vector3(x, 0.13, z),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng.range(0, Math.PI)),
          new THREE.Vector3(scale, scale * rng.range(0.7, 1.3), scale),
        )
        instanced.setMatrixAt(placed, matrix)
        // Brightness variation, nudged a little toward the bed's theme colour.
        const shade = rng.range(0.78, 1.15)
        colour.setRGB(shade, shade, shade).lerp(tint, 0.14)
        instanced.setColorAt(placed, colour)
        placed++
        inBed++
      }
    }
    instanced.count = placed
    instanced.instanceMatrix.needsUpdate = true
    if (instanced.instanceColor) instanced.instanceColor.needsUpdate = true
  }, [dark, perBed, placements])

  return (
    <instancedMesh ref={mesh} args={[geometry, undefined, total]} frustumCulled={false}>
      <meshStandardMaterial color={dark ? '#3f6740' : '#5f9a52'} side={THREE.DoubleSide} roughness={1} />
    </instancedMesh>
  )
}

/** Scattered tufts of grass, drawn as one instanced mesh. */
function GrassTufts({ count, dark }: { count: number; dark: boolean }) {
  const mesh = useRef<THREE.InstancedMesh>(null)

  const geometry = useMemo(() => tuftGeometry(0.07, 0.095), [])

  useEffect(() => {
    const instanced = mesh.current
    if (!instanced) return
    const rng = makeRng(4242)
    const matrix = new THREE.Matrix4()
    const colour = new THREE.Color()
    let placed = 0
    let guard = 0

    while (placed < count && guard < count * 12) {
      guard++
      const angle = rng.next() * Math.PI * 2
      const radius = 3.4 + rng.next() * (GARDEN_EXTENT - 4.6)
      const x = Math.cos(angle) * radius
      const z = Math.sin(angle) * radius
      // Keep the walkways and beds clear.
      if (Math.abs(radius - 10.6) < 0.7) continue
      if (gardenBeds.some((b) => Math.hypot(x - b.position[0], z - b.position[1]) < BED_RADIUS + 0.5)) continue

      const scale = rng.range(0.6, 1.0)
      matrix.compose(
        new THREE.Vector3(x, 0, z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng.range(0, Math.PI)),
        new THREE.Vector3(scale, scale * rng.range(0.8, 1.4), scale),
      )
      instanced.setMatrixAt(placed, matrix)
      // The material carries the colour; instances only shift its brightness,
      // so the lawn still looks right even where instance colour is unsupported.
      const shade = rng.range(0.82, 1.12)
      colour.setRGB(shade, shade * rng.range(0.97, 1.04), shade * 0.97)
      instanced.setColorAt(placed, colour)
      placed++
    }
    instanced.count = placed
    instanced.instanceMatrix.needsUpdate = true
    if (instanced.instanceColor) instanced.instanceColor.needsUpdate = true
  }, [count, dark])

  return (
    <instancedMesh ref={mesh} args={[geometry, undefined, count]} frustumCulled={false}>
      <meshStandardMaterial color={dark ? '#3b5a3a' : '#6f9150'} roughness={1} />
    </instancedMesh>
  )
}

/* ---------------------------- the scene ---------------------------- */

interface GardenSceneProps {
  goal: CameraGoal
  selectedId: string | null
  hoveredId: string | null
  onHover: (id: string | null) => void
  onSelect: (id: string) => void
  onSelectBed: (bed: GardenBed) => void
  idleSpin: boolean
  showLabels: boolean
  /** When true, OrbitControls are suspended and first-person walking takes over. */
  walkMode?: boolean
  /** Called when the walker wants to exit (Escape key). */
  onExitWalk?: () => void
  /** Plant id the walk-mode crosshair is currently aimed at (for highlight). */
  walkNearby?: string | null
  /** Called by the walker when the player looks at / clicks on a plant. */
  onWalkSelect?: (id: string) => void
  /** Called every frame with the plant id under the crosshair (or null). */
  onWalkNearby?: (id: string | null) => void
  /** When true pointer lock is released so the user can click UI elements. */
  cursorFree?: boolean
  /** Called to toggle cursor-free mode. */
  onToggleCursor?: () => void
}

function SceneContents({
  goal,
  selectedId,
  hoveredId,
  onHover,
  onSelect,
  onSelectBed,
  idleSpin,
  showLabels,
  walkMode = false,
  onExitWalk,
  walkNearby,
  onWalkSelect,
  onWalkNearby,
  cursorFree = false,
  onToggleCursor,
  detail,
  dark,
}: GardenSceneProps & { detail: Detail; dark: boolean }) {
  const controls = useRef<OrbitControlsImpl | null>(null)
  const placements = useGardenLayout()
  const reducedMotion = useGarden((s) => s.reducedMotion)
  const shadows = detail !== 'low'

  return (
    <>
      <color attach="background" args={[dark ? '#101d18' : '#cfdbe4']} />
      <fog attach="fog" args={[dark ? '#101d18' : '#cfdbe4', 30, 68]} />

      <WindClock strength={reducedMotion ? 0 : 1} />

      <hemisphereLight args={[dark ? '#6f92a8' : '#bcd8ee', dark ? '#26401f' : '#5d6b3a', dark ? 1.15 : 1.1]} />
      <directionalLight
        position={[9, 14, 7]}
        intensity={dark ? 1.9 : 2.4}
        color={dark ? '#b7d4ec' : '#fff2d8'}
        castShadow={shadows}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-16}
        shadow-camera-right={16}
        shadow-camera-top={16}
        shadow-camera-bottom={-16}
        shadow-camera-far={40}
        shadow-bias={-0.0015}
      />
      <directionalLight position={[-8, 6, -9]} intensity={dark ? 0.7 : 0.6} color={dark ? '#5f9c80' : '#a9c99b'} />

      <Ground dark={dark} />
      <Plaza dark={dark} />
      <BedPlinths dark={dark} />
      <GrassTufts count={detail === 'low' ? 1100 : 2400} dark={dark} />
      <BedUndergrowth dark={dark} perBed={detail === 'low' ? 26 : 44} />

      <Suspense fallback={null}>
        {placements.map(({ plant, position, spin, scale }) => (
          <group
            key={plant.id}
            position={[position[0], 0.13, position[2]]}
            userData={{ plantId: plant.id }}
          >
            <PlantObject
              plant={plant}
              detail={detail}
              spin={spin}
              scale={scale}
              grow
              showSoil={false}
              castShadow={shadows}
              highlight={
                walkMode
                  ? walkNearby === plant.id
                  : hoveredId === plant.id || selectedId === plant.id
              }
              onPointerOver={
                walkMode
                  ? undefined
                  : (e) => {
                      ;(e as unknown as { stopPropagation: () => void }).stopPropagation()
                      onHover(plant.id)
                      document.body.style.cursor = 'pointer'
                    }
              }
              onPointerOut={
                walkMode
                  ? undefined
                  : () => {
                      onHover(null)
                      document.body.style.cursor = ''
                    }
              }
              onClick={
                walkMode
                  ? undefined
                  : (e) => {
                      ;(e as unknown as { stopPropagation: () => void }).stopPropagation()
                      onSelect(plant.id)
                    }
              }
            />
            {!walkMode && (hoveredId === plant.id || selectedId === plant.id) && (
              <Html position={[0, plant.model.height * scale + 0.22, 0]} center zIndexRange={[15, 0]}>
                <span
                  className="pointer-events-none -translate-y-2 rounded-full px-2.5 py-1 text-[12px] font-medium whitespace-nowrap text-white shadow-lg"
                  style={{ background: plant.accent }}
                >
                  {plant.name}
                </span>
              </Html>
            )}
            {walkMode && walkNearby === plant.id && (
              <Html position={[0, plant.model.height * scale + 0.22, 0]} center zIndexRange={[15, 0]}>
                <span
                  className="pointer-events-none -translate-y-2 rounded-full px-2.5 py-1 text-[12px] font-medium whitespace-nowrap text-white shadow-lg animate-pulse"
                  style={{ background: plant.accent }}
                >
                  {plant.name} — press E
                </span>
              </Html>
            )}
          </group>
        ))}
      </Suspense>

      {showLabels &&
        gardenBeds.map((bed) => (
          <Html
            key={bed.id}
            position={[bed.position[0], 1.05, bed.position[1] + BED_RADIUS + 0.55]}
            center
            zIndexRange={[10, 0]}
          >
            <button
              onClick={() => onSelectBed(bed)}
              className="rounded-full border border-white/25 px-3 py-1.5 text-[12px] font-semibold whitespace-nowrap text-white/95 shadow-lg backdrop-blur-sm transition-transform hover:scale-105"
              style={{ background: `${bed.accent}dd` }}
            >
              {bed.name}
            </button>
          </Html>
        ))}

      {/* Walk mode: swap OrbitControls for the first-person walker */}
      {walkMode ? (
        <FirstPersonWalker
          active={walkMode}
          onExit={onExitWalk ?? (() => {})}
          cursorFree={cursorFree}
          onToggleCursor={onToggleCursor ?? (() => {})}
          onNearby={onWalkNearby}
          onSelect={onWalkSelect}
        />
      ) : (
        <CameraRig goal={goal} controls={controls} idleSpin={idleSpin} />
      )}
    </>
  )
}

export function GardenScene(props: GardenSceneProps) {
  const detail = useDetail('garden')
  const theme = useGarden((s) => s.theme)
  const dark = theme === 'dark'

  return (
    <Canvas
      shadows={detail !== 'low'}
      dpr={dprFor(detail)}
      gl={{ antialias: detail !== 'low', powerPreference: 'high-performance' }}
      camera={{ fov: 42, near: 0.1, far: 90, position: [0, 11, 18] }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping
        gl.toneMappingExposure = dark ? 1.18 : 1.08
      }}
      onPointerMissed={() => props.onHover(null)}
    >
      <SceneContents
        {...props}
        detail={detail}
        dark={dark}
        walkMode={props.walkMode}
        onExitWalk={props.onExitWalk}
        walkNearby={props.walkNearby}
        onWalkSelect={props.onWalkSelect}
        onWalkNearby={props.onWalkNearby}
        cursorFree={props.cursorFree}
        onToggleCursor={props.onToggleCursor}
      />
    </Canvas>
  )
}
