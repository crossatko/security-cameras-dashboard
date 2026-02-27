<script setup lang="ts">
import Hls from "hls.js";

interface Camera {
  id: number;
  name: string;
  mainStreamUrl: string;
  subStreamUrl: string;
  ready?: boolean;
}

function getHlsUrl(cameraId: number, type: "main" | "sub") {
  return `/api/streams/cam${cameraId}_${type}.m3u8`;
}

const cameras = ref<Camera[]>([]);
const showAddForm = ref(false);
const selectedCamera = ref<Camera | null>(null);
const form = ref<{ name: string; mainStreamUrl: string; subStreamUrl: string }>(
  {
    name: "",
    mainStreamUrl: "",
    subStreamUrl: "",
  },
);

const featuredCameraId = ref<number | null>(null);
const effectiveFeaturedCameraId = computed(() => {
  const id = featuredCameraId.value;
  if (id != null && cameras.value.some((c) => c.id === id)) return id;
  return cameras.value[0]?.id ?? null;
});

const hlsInstances = ref<Map<number, Hls>>(new Map());
const mainHlsInstances = ref<Map<number, Hls>>(new Map());

let isUnmounted = false;

const displayCameras = computed(() => {
  const id = effectiveFeaturedCameraId.value;
  if (id == null) return cameras.value;
  const featured = cameras.value.find((c) => c.id === id);
  if (!featured) return cameras.value;
  const rest = cameras.value.filter((c) => c.id !== id);
  return [featured, ...rest];
});

function splitSpans(total: number, parts: number) {
  const base = Math.floor(total / parts);
  const rem = total % parts;
  const spans: number[] = [];
  for (let i = 0; i < parts; i++) spans.push(base + (i < rem ? 1 : 0));
  return spans;
}

const tilePlacementById = computed(() => {
  const BASE = 24;
  const list = displayCameras.value;
  const n = list.length;
  const placements = new Map<number, { gridColumn: string; gridRow: string }>();
  if (n === 0) return placements;

  const wantFeaturedSpan = n > 1;

  // Coarse tile grid (<= 4x4 for up to 16 cameras). We intentionally do NOT
  // add extra rows/cols just to force a featured span; the span only happens
  // when there's already slack space in the chosen grid.
  let tileCols = 4;
  let tileRows = 4;
  if (n <= 1) {
    tileCols = 1;
    tileRows = 1;
  } else if (n <= 2) {
    tileCols = 2;
    tileRows = 1;
  } else if (n <= 4) {
    tileCols = 2;
    tileRows = 2;
  } else if (n <= 6) {
    tileCols = 3;
    tileRows = 2;
  } else if (n <= 8) {
    tileCols = 4;
    tileRows = 2;
  } else if (n <= 12) {
    tileCols = 4;
    tileRows = 3;
  } else {
    tileCols = 4;
    tileRows = 4;
  }

  const colSpans = splitSpans(BASE, tileCols);
  const rowSpans = splitSpans(BASE, tileRows);
  const colStarts: number[] = [];
  {
    let start = 1;
    for (const span of colSpans) {
      colStarts.push(start);
      start += span;
    }
  }
  const rowStarts: number[] = [];
  {
    let start = 1;
    for (const span of rowSpans) {
      rowStarts.push(start);
      start += span;
    }
  }

  const occupied = Array.from({ length: tileRows }, () => Array(tileCols).fill(false));

  const canSpan =
    wantFeaturedSpan &&
    tileRows >= 2 &&
    tileCols * tileRows > n;
  let index = 0;

  if (canSpan) {
    const cam = list[index++];
    occupied[0][0] = true;
    occupied[1][0] = true;

    const colStart = colStarts[0];
    const rowStart = rowStarts[0];
    const colSpan = colSpans[0];
    const rowSpan = rowSpans[0] + rowSpans[1];
    placements.set(cam.id, {
      gridColumn: `${colStart} / span ${colSpan}`,
      gridRow: `${rowStart} / span ${rowSpan}`,
    });
  }

  for (; index < n; index++) {
    const cam = list[index];
    let placed = false;

    for (let r = 0; r < tileRows && !placed; r++) {
      for (let c = 0; c < tileCols && !placed; c++) {
        if (occupied[r][c]) continue;
        occupied[r][c] = true;

        const colStart = colStarts[c];
        const rowStart = rowStarts[r];
        const colSpan = colSpans[c];
        const rowSpan = rowSpans[r];
        placements.set(cam.id, {
          gridColumn: `${colStart} / span ${colSpan}`,
          gridRow: `${rowStart} / span ${rowSpan}`,
        });
        placed = true;
      }
    }
  }

  // Fallback: if something went wrong, ensure every camera at least renders.
  for (const cam of list) {
    if (!placements.has(cam.id)) {
      placements.set(cam.id, { gridColumn: "1 / span 24", gridRow: "1 / span 24" });
    }
  }

  return placements;
});

function tileStyle(id: number) {
  return tilePlacementById.value.get(id) ?? {};
}

function setFeaturedCamera(id: number) {
  featuredCameraId.value = id;
}

async function checkStreamExists(url: string): Promise<boolean> {
  const start = Date.now();
  try {
    const response = await fetch(url, { method: "HEAD", cache: "no-store" });
    console.log(
      `[checkStreamExists] ${url} - ${response.ok} (${Date.now() - start}ms)`,
    );
    return response.ok;
  } catch (e) {
    console.log(
      `[checkStreamExists] ${url} - error: ${e} (${Date.now() - start}ms)`,
    );
    return false;
  }
}

async function waitForStream(url: string, maxAttempts = 120): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    if (isUnmounted) return false;
    const exists = await checkStreamExists(url);
    if (exists) return true;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

async function setupPlayerForCamera(camera: Camera) {
  if (!camera.subStreamUrl) return;

  const hlsUrl = getHlsUrl(camera.id, "sub");
  console.log(`Checking stream for camera ${camera.id}: ${hlsUrl}`);

  // Ensure the server starts (or restarts) the stream on demand.
  try {
    await $fetch("/api/stream", {
      method: "POST",
      body: {
        id: camera.id,
        which: "sub",
        // name/mainStreamUrl/subStreamUrl are ignored server-side now; kept for backward compat.
        name: camera.name,
        mainStreamUrl: camera.mainStreamUrl,
        subStreamUrl: camera.subStreamUrl,
      },
    });
  } catch (e) {
    console.warn(
      `[setupPlayerForCamera] failed to start stream for ${camera.id}`,
      e,
    );
  }

  const ready = await waitForStream(hlsUrl, 60);
  console.log(`Stream ready for camera ${camera.id}: ${ready}`);

  const camIndex = cameras.value.findIndex((c) => c.id === camera.id);
  if (camIndex !== -1) {
    cameras.value[camIndex].ready = ready;
  }

  if (ready) {
    await nextTick();
    const videoEl = document.getElementById(
      `video-${camera.id}`,
    ) as HTMLVideoElement;
    if (videoEl) {
      console.log(`Setting up player for camera ${camera.id}`);
      setupPlayer(videoEl, hlsUrl, camera.id!, false);
    }
  }
}

async function fetchCameras() {
  const prevReady = new Map<number, boolean>();
  for (const c of cameras.value) {
    prevReady.set(c.id, Boolean(c.ready));
  }

  const allCameras = await $fetch<Camera[]>("/api/cameras");

  cameras.value = allCameras.map((c) => ({
    ...c,
    // Preserve current UI state for existing players.
    // New cameras start in loading state until waitForStream completes.
    ready: prevReady.get(c.id) ?? false,
  }));

  if (featuredCameraId.value == null && cameras.value.length) {
    featuredCameraId.value = cameras.value[0].id;
  }
}

async function addCamera() {
  try {
    const created = await $fetch<Camera>("/api/cameras", {
      method: "POST",
      body: {
        name: form.value.name,
        mainRtspUrl: form.value.mainStreamUrl,
        subRtspUrl: form.value.subStreamUrl,
      },
    });

    form.value = { name: "", mainStreamUrl: "", subStreamUrl: "" };
    showAddForm.value = false;
    await fetchCameras();

    const newCamera = cameras.value.find((c) => c.id === created.id);
    if (newCamera) {
      await setupPlayerForCamera(newCamera);
    }
  } catch (e) {
    console.error("Error adding camera:", e);
    alert("Failed to add camera: " + e);
  }
}

async function deleteCamera(id: number) {
  const hls = hlsInstances.value.get(id);
  if (hls) {
    hls.destroy();
    hlsInstances.value.delete(id);
  }

  const mainHls = mainHlsInstances.value.get(id);
  if (mainHls) {
    mainHls.destroy();
    mainHlsInstances.value.delete(id);
  }

  await $fetch(`/api/cameras/${id}`, { method: "DELETE" });
  await fetchCameras();
}

function setupPlayer(
  video: HTMLVideoElement,
  url: string,
  cameraId: number,
  isMain: boolean,
) {
  if (!video || !url) return;

  const instances = isMain ? mainHlsInstances.value : hlsInstances.value;
  const existing = instances.get(cameraId);
  if (existing) {
    existing.destroy();
  }

  if (Hls.isSupported()) {
    const hls = new Hls({
      lowLatencyMode: true,
      liveSyncDurationCount: 1,
      liveMaxLatencyDurationCount: 2,
      backBufferLength: 0,
      maxBufferLength: 2,
      liveDurationInfinity: true,
    });
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      video.play().catch(console.error);
    });
    hls.on(Hls.Events.ERROR, (event, data) => {
      console.error(`HLS error for camera ${cameraId}:`, data);
    });
    hls.loadSource(url);
    hls.attachMedia(video);
    instances.set(cameraId, hls);
  } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
    video.src = url;
    video.play().catch(console.error);
  }
}

function openMainStream(camera: Camera) {
  selectedCamera.value = camera;
  nextTick(async () => {
    const hlsUrl = getHlsUrl(camera.id, "main");

    try {
      await $fetch("/api/stream", {
        method: "POST",
        body: {
          id: camera.id,
          which: "main",
          name: camera.name,
          mainStreamUrl: camera.mainStreamUrl,
          subStreamUrl: camera.subStreamUrl,
        },
      });
    } catch (e) {
      console.warn(
        `[openMainStream] failed to start main stream for ${camera.id}`,
        e,
      );
    }

    const ready = await waitForStream(hlsUrl, 60);
    if (ready) {
      const videoEl = document.getElementById(
        `main-video-${camera.id}`,
      ) as HTMLVideoElement;
      if (videoEl) {
        setupPlayer(videoEl, hlsUrl, camera.id!, true);
      }
    }
  });
}

function closeMainStream() {
  if (selectedCamera.value?.id) {
    const hls = mainHlsInstances.value.get(selectedCamera.value.id);
    if (hls) {
      hls.destroy();
      mainHlsInstances.value.delete(selectedCamera.value.id);
    }
  }
  selectedCamera.value = null;
}

onMounted(async () => {
  isUnmounted = false;
  await fetchCameras();

  for (const camera of cameras.value) {
    void setupPlayerForCamera(camera);
  }
});

onUnmounted(() => {
  isUnmounted = true;
  hlsInstances.value.forEach((hls) => hls.destroy());
  mainHlsInstances.value.forEach((hls) => hls.destroy());
});
</script>

<template>
  <div class="h-screen bg-black text-white flex flex-col">
    <div
      class="shrink-0 flex items-center gap-3 px-2 py-2 border-b border-white/10"
    >
      <div class="font-medium">Cameras ({{ cameras.length }})</div>
      <div class="flex-1" />
      <button
        @click="showAddForm = !showAddForm"
        class="px-3 py-1 border border-white/20 hover:border-white/40"
      >
        {{ showAddForm ? "Close" : "Add" }}
      </button>
    </div>

    <div v-if="showAddForm" class="shrink-0 px-2 py-2 border-b border-white/10">
      <form
        @submit.prevent="addCamera"
        class="grid grid-cols-1 md:grid-cols-3 gap-2 items-end"
      >
        <label class="block">
          <div class="text-xs text-white/70 mb-1">Name</div>
          <input
            v-model="form.name"
            type="text"
            required
            class="w-full bg-black border border-white/20 px-2 py-1"
          />
        </label>
        <label class="block">
          <div class="text-xs text-white/70 mb-1">Main RTSP</div>
          <input
            v-model="form.mainStreamUrl"
            type="text"
            required
            class="w-full bg-black border border-white/20 px-2 py-1"
          />
        </label>
        <label class="block">
          <div class="text-xs text-white/70 mb-1">Sub RTSP</div>
          <input
            v-model="form.subStreamUrl"
            type="text"
            required
            class="w-full bg-black border border-white/20 px-2 py-1"
          />
        </label>
        <div class="md:col-span-3 flex gap-2">
          <button
            type="submit"
            class="px-3 py-1 border border-white/20 hover:border-white/40"
          >
            Save
          </button>
        </div>
      </form>
    </div>

    <div v-if="cameras.length" class="flex-1 min-h-0">
      <div
        class="grid w-full h-full gap-px bg-white/10"
        style="grid-template-columns: repeat(24, minmax(0, 1fr)); grid-template-rows: repeat(24, minmax(0, 1fr));"
      >
        <div
          v-for="camera in displayCameras"
          :key="camera.id"
          class="bg-black relative"
          :style="tileStyle(camera.id)"
          @click="openMainStream(camera)"
        >
          <div
            v-if="!camera.ready"
            class="absolute inset-0 flex items-center justify-center text-white/60 text-sm"
          >
            Loading
          </div>
          <video
            :id="`video-${camera.id}`"
            :style="{ opacity: camera.ready ? 1 : 0 }"
            autoplay
            muted
            class="w-full h-full object-cover"
          />

          <div class="absolute left-1 right-1 bottom-1 flex items-center gap-2 text-xs">
            <div class="flex-1 truncate bg-black/60 px-1 py-0.5">
              {{ camera.name }}
            </div>
            <button
              @click.stop="setFeaturedCamera(camera.id)"
              class="bg-black/60 px-1 py-0.5 border border-white/10 hover:border-white/30"
              :class="camera.id === effectiveFeaturedCameraId ? 'border-white/60' : ''"
              title="Make large"
            >
              Large
            </button>
            <button
              @click.stop="deleteCamera(camera.id)"
              class="bg-black/60 px-1 py-0.5 border border-white/10 hover:border-white/30"
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>

    <div
      v-else
      class="flex-1 min-h-0 grid place-items-center text-white/60 text-sm"
    >
      No cameras
    </div>

    <Teleport to="body">
      <div
        v-if="selectedCamera"
        class="fixed inset-0 bg-black/90 z-50 flex items-center justify-center"
        @click="closeMainStream"
      >
        <div class="w-full h-full p-2 flex flex-col">
          <div class="flex justify-between items-center mb-2">
            <h2 class="text-sm">{{ selectedCamera.name }}</h2>
            <button
              @click="closeMainStream"
              class="px-2 text-white py-1 border border-white/20 hover:border-white/40"
            >
              Close
            </button>
          </div>
          <div class="flex-1 bg-black">
            <video
              :id="`main-video-${selectedCamera.id}`"
              controls
              autoplay
              muted
              class="w-full h-full object-contain"
            />
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
