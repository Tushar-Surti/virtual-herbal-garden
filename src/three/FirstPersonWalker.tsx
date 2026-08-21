/**
 * FirstPersonWalker.tsx
 *
 * A self-contained first-person walk controller that lives inside the R3F
 * <Canvas>. When `active` is false the component is a no-op; the existing
 * OrbitControls camera rig stays in charge.
 *
 * Controls
 * --------
 *  W / ↑          Walk forward
 *  S / ↓          Walk backward
 *  A / ←          Strafe left
 *  D / →          Strafe right
 *  Shift           Sprint
 *  E               Inspect plant in crosshair
 *  Mouse (locked)  Look
 *  Escape          Exit walk mode (calls onExit)
 *
 * Collision
 * ---------
 *  • Six circular garden beds (radius BED_RADIUS, centred at each bed pos)
 *  • Circular perimeter wall (radius PERIMETER_RADIUS)
 *
 * Plant interaction
 * -----------------
 *  • Each frame a ray is cast from the camera through (0,0) normalised device coords
 *  • If a plant group (userData.plantId) is hit within MAX_INTERACT_DIST, it is
 *    reported as "nearby" via onNearby so GardenScene can highlight it
 *  • Pressing E (or clicking while pointer-locked) calls onSelect with that plant id
 *
 * No 3D geometry is created — collision and raycasting are purely logical.
 */

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { BED_RADIUS, gardenBeds } from '../data/plants'

/* ------------------------------------------------------------------ */
/* Constants                                                            */
/* ------------------------------------------------------------------ */

const EYE_HEIGHT = 1.65            // metres above ground
const WALK_SPEED = 4.5             // units / second
const SPRINT_SPEED = 8.0           // units / second while Shift held
const PLAYER_RADIUS = 0.35         // collision capsule footprint
const PERIMETER_RADIUS = 12.0      // invisible outer wall radius
const PITCH_LIMIT = Math.PI * 0.44 // ≈ 79° — prevents full flip
const MAX_INTERACT_DIST = 6.0      // metres within which plants are interactive

/* ------------------------------------------------------------------ */
/* Collision helpers                                                    */
/* ------------------------------------------------------------------ */

function resolveCollision(x: number, z: number): [number, number] {
  let rx = x
  let rz = z

  // 1. Push out of each garden bed circle
  for (const bed of gardenBeds) {
    const [bx, bz] = bed.position
    const dx = rx - bx
    const dz = rz - bz
    const dist = Math.sqrt(dx * dx + dz * dz)
    const minDist = BED_RADIUS + PLAYER_RADIUS
    if (dist < minDist && dist > 0.001) {
      const nx = dx / dist
      const nz = dz / dist
      rx = bx + nx * minDist
      rz = bz + nz * minDist
    }
  }

  // 2. Clamp inside the perimeter wall
  const pr = Math.sqrt(rx * rx + rz * rz)
  const maxR = PERIMETER_RADIUS - PLAYER_RADIUS
  if (pr > maxR && pr > 0.001) {
    rx = (rx / pr) * maxR
    rz = (rz / pr) * maxR
  }

  return [rx, rz]
}

/* ------------------------------------------------------------------ */
/* Find plant id from a hit object by walking up its parent chain      */
/* ------------------------------------------------------------------ */

function plantIdFromObject(obj: THREE.Object3D | null): string | null {
  let cur = obj
  while (cur) {
    if (cur.userData?.plantId) return cur.userData.plantId as string
    cur = cur.parent
  }
  return null
}

/* ------------------------------------------------------------------ */
/* Component                                                            */
/* ------------------------------------------------------------------ */

interface FirstPersonWalkerProps {
  /** When false the component does nothing — orbit controls stay active. */
  active: boolean
  /** Called when Escape is pressed to let the parent exit walk mode. */
  onExit: () => void
  /** When true, pointer lock is released so the user can click UI elements. */
  cursorFree: boolean
  /** Called to toggle cursor free mode from within the walker (Tab key). */
  onToggleCursor: () => void
  /** Called with the plant id the player is currently aiming at (or null). */
  onNearby?: (id: string | null) => void
  /** Called when the player selects a plant (E key or click). */
  onSelect?: (id: string) => void
}

export function FirstPersonWalker({ active, onExit, cursorFree, onToggleCursor, onNearby, onSelect }: FirstPersonWalkerProps) {
  const { camera, gl, scene } = useThree()

  // ---- refs so frame loop reads current values without re-render ----
  const keys = useRef<Set<string>>(new Set())
  const yaw = useRef(0)
  const pitch = useRef(0)
  const locked = useRef(false)
  const onExitRef = useRef(onExit)
  onExitRef.current = onExit
  const onToggleCursorRef = useRef(onToggleCursor)
  onToggleCursorRef.current = onToggleCursor
  const cursorFreeRef = useRef(cursorFree)
  cursorFreeRef.current = cursorFree
  const onNearbyRef = useRef(onNearby)
  onNearbyRef.current = onNearby
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  const lastNearby = useRef<string | null>(null)
  const raycaster = useRef(new THREE.Raycaster())

  // ---- initialise camera to eye height when walk mode activates ----
  const didInit = useRef(false)
  useEffect(() => {
    if (!active) {
      didInit.current = false
      // Clear nearby when leaving walk mode
      if (lastNearby.current !== null) {
        lastNearby.current = null
        onNearbyRef.current?.(null)
      }
      return
    }

    if (!didInit.current) {
      const startX = THREE.MathUtils.clamp(camera.position.x, -5, 5)
      const startZ = THREE.MathUtils.clamp(camera.position.z, -5, 5)
      camera.position.set(startX, EYE_HEIGHT, startZ)
      const toCenter = Math.atan2(-startX, -startZ)
      yaw.current = toCenter
      pitch.current = 0
      didInit.current = true
    }
  }, [active, camera])

  // ---- pointer lock — exit when cursorFree, acquire when not --------
  useEffect(() => {
    if (!active) return
    const canvas = gl.domElement
    if (cursorFree) {
      // Free the cursor so UI buttons can be clicked
      if (document.pointerLockElement === canvas) document.exitPointerLock()
      return
    }
    // cursorFree is false — set up lock as normal
    const requestLock = () => {
      if (!document.pointerLockElement && !cursorFreeRef.current) canvas.requestPointerLock()
    }
    const onLockChange = () => {
      locked.current = document.pointerLockElement === canvas
    }
    const onMouseMove = (e: MouseEvent) => {
      if (!locked.current || cursorFreeRef.current) return
      const sensitivity = 0.0018
      yaw.current -= e.movementX * sensitivity
      pitch.current = THREE.MathUtils.clamp(
        pitch.current - e.movementY * sensitivity,
        -PITCH_LIMIT,
        PITCH_LIMIT,
      )
    }
    // Click while pointer-locked = inspect nearby plant
    const onClick = () => {
      if (locked.current && !cursorFreeRef.current && lastNearby.current) {
        onSelectRef.current?.(lastNearby.current)
      }
    }
    canvas.addEventListener('click', requestLock)
    canvas.addEventListener('click', onClick)
    document.addEventListener('pointerlockchange', onLockChange)
    document.addEventListener('mousemove', onMouseMove)
    return () => {
      canvas.removeEventListener('click', requestLock)
      canvas.removeEventListener('click', onClick)
      document.removeEventListener('pointerlockchange', onLockChange)
      document.removeEventListener('mousemove', onMouseMove)
      if (document.pointerLockElement === canvas) document.exitPointerLock()
      locked.current = false
    }
  }, [active, cursorFree, gl.domElement])

  // ---- keyboard ---------------------------------------------------
  useEffect(() => {
    if (!active) return

    const onKeyDown = (e: KeyboardEvent) => {
      keys.current.add(e.code)

      if (e.code === 'Escape') {
        if (cursorFreeRef.current) {
          // First Esc press frees cursor → second exits walk mode
          onToggleCursorRef.current()
        } else {
          onExitRef.current()
        }
      }

      // Tab = toggle cursor free
      if (e.code === 'Tab') {
        e.preventDefault()
        onToggleCursorRef.current()
      }

      // E key = inspect plant in crosshair (only when locked)
      if (e.code === 'KeyE' && !cursorFreeRef.current && lastNearby.current) {
        onSelectRef.current?.(lastNearby.current)
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      keys.current.delete(e.code)
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      keys.current.clear()
    }
  }, [active])

  // ---- frame loop -------------------------------------------------
  useFrame((_, delta) => {
    if (!active) return

    // --- Look (yaw + pitch → quaternion) ---
    const qYaw = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      yaw.current,
    )
    const qPitch = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(1, 0, 0),
      pitch.current,
    )
    camera.quaternion.copy(qYaw).multiply(qPitch)

    // --- Movement (paused when cursor is free) ---
    if (!cursorFreeRef.current) {
      const k = keys.current
      const sprinting = k.has('ShiftLeft') || k.has('ShiftRight')
      const speed = sprinting ? SPRINT_SPEED : WALK_SPEED
      const dt = Math.min(delta, 0.1)

      let fx = 0
      let fz = 0
      if (k.has('KeyW') || k.has('ArrowUp'))    { fx -= Math.sin(yaw.current); fz -= Math.cos(yaw.current) }
      if (k.has('KeyS') || k.has('ArrowDown'))  { fx += Math.sin(yaw.current); fz += Math.cos(yaw.current) }
      if (k.has('KeyA') || k.has('ArrowLeft'))  { fx -= Math.cos(yaw.current); fz += Math.sin(yaw.current) }
      if (k.has('KeyD') || k.has('ArrowRight')) { fx += Math.cos(yaw.current); fz -= Math.sin(yaw.current) }

      const len = Math.sqrt(fx * fx + fz * fz)
      if (len > 0.001) {
        fx = (fx / len) * speed * dt
        fz = (fz / len) * speed * dt
        const [nx, nz] = resolveCollision(camera.position.x + fx, camera.position.z + fz)
        camera.position.x = nx
        camera.position.z = nz
      }
    }
    camera.position.y = EYE_HEIGHT

    // --- Crosshair raycast: find nearby plant (only when locked) ---
    if (!cursorFreeRef.current) {
      raycaster.current.setFromCamera({ x: 0, y: 0 }, camera)
      raycaster.current.far = MAX_INTERACT_DIST
      const hits = raycaster.current.intersectObjects(scene.children, true)

      let nearId: string | null = null
      for (const hit of hits) {
        const id = plantIdFromObject(hit.object)
        if (id) { nearId = id; break }
      }

      if (nearId !== lastNearby.current) {
        lastNearby.current = nearId
        onNearbyRef.current?.(nearId)
      }
    } else if (lastNearby.current !== null) {
      // Clear nearby highlight when cursor is freed
      lastNearby.current = null
      onNearbyRef.current?.(null)
    }
  })

  return null
}
