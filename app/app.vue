<script setup lang="ts">
import Hls from "hls.js";
const { t } = useI18n();

interface Camera {
  id: number;
  name: string;
  mainRtspUrl?: string;
  subRtspUrl?: string;
  mainStreamUrl: string;
  subStreamUrl: string;
  ready?: boolean;
}

function getHlsUrl(cameraId: number, type: "main" | "sub") {
  return `/api/streams/cam${cameraId}_${type}.m3u8`;
}

const cameras = ref<Camera[]>([]);
const showAddForm = ref(false);
const editingCameraId = ref<number | null>(null);
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
let pollTimer: ReturnType<typeof setInterval> | null = null;
const isRefreshInFlight = ref(false);

function camerasConfigSignature(list: Camera[]) {
  return list
    .map(
      (c) =>
        `${c.id}:${c.name}:${c.mainRtspUrl ?? ""}:${c.subRtspUrl ?? ""}`,
    )
    .join("|");
}

const displayCameras = computed(() => {
  const id = effectiveFeaturedCameraId.value;
  if (id == null) return cameras.value;
  const featured = cameras.value.find((c) => c.id === id);
  if (!featured) return cameras.value;
  const rest = cameras.value.filter((c) => c.id !== id);
  return [featured, ...rest];
});

const CAMERA_ASPECT = 5 / 4;

const gridEl = ref<HTMLElement | null>(null);
const viewport = ref({ width: 1, height: 1 });

let gridResizeObserver: ResizeObserver | null = null;

function updateViewport() {
  const el = gridEl.value;
  if (el) {
    viewport.value = {
      width: Math.max(1, el.clientWidth || 1),
      height: Math.max(1, el.clientHeight || 1),
    };
    return;
  }

  viewport.value = {
    width: Math.max(1, window.innerWidth || 1),
    height: Math.max(1, window.innerHeight || 1),
  };
}

function coverCropFraction(tileAspect: number, contentAspect: number) {
  const a = tileAspect;
  const b = contentAspect;
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return 1;
  const min = Math.min(a, b);
  const max = Math.max(a, b);
  return 1 - min / max;
}

function pickGridForCount(n: number, containerAspect: number) {
  const safeContainerAspect =
    Number.isFinite(containerAspect) && containerAspect > 0
      ? containerAspect
      : 16 / 9;

  const desiredEmpty = n > 1 && n % 2 === 1 ? 1 : 0;
  const maxCols = 5;
  const maxRows = 4;

  let best = { cols: 1, rows: 1 };
  let bestScore = Number.POSITIVE_INFINITY;
  const eps = 1e-9;

  for (let rows = 1; rows <= maxRows; rows++) {
    for (let cols = 1; cols <= maxCols; cols++) {
      const capacity = rows * cols;
      if (capacity < n) continue;

      const empties = capacity - n;
      const tileAspect = safeContainerAspect * (rows / cols);
      const crop = coverCropFraction(tileAspect, CAMERA_ASPECT);

      const emptyRatio = empties / capacity;
      const parityPenalty =
        desiredEmpty === 0
          ? empties === 0
            ? 0
            : Math.min(0.25, 0.05 * empties)
          : empties === 1
            ? 0
            : Math.min(0.25, 0.05 * Math.abs(empties - 1));

      const shapePenalty = Math.abs(cols - rows) * 0.0005;

      const score = crop + emptyRatio * 0.15 + parityPenalty + shapePenalty;
      if (score + eps < bestScore) {
        bestScore = score;
        best = { cols, rows };
      }
    }
  }

  return best;
}

const grid = computed(() => {
  const n = displayCameras.value.length;
  if (n <= 0) return { cols: 1, rows: 1 };

  // Single camera should always be full-screen (no intentional empty tile).
  if (n === 1) return { cols: 1, rows: 1 };

  const containerAspect = viewport.value.width / viewport.value.height;
  return pickGridForCount(n, containerAspect);
});

const gridStyle = computed(() => {
  return {
    gridTemplateColumns: `repeat(${grid.value.cols}, minmax(0, 1fr))`,
    gridTemplateRows: `repeat(${grid.value.rows}, minmax(0, 1fr))`,
  };
});

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

function destroyPlayersForCamera(id: number) {
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
}

async function refreshCamerasAndPlayers() {
  if (isUnmounted) return;
  if (isRefreshInFlight.value) return;
  isRefreshInFlight.value = true;

  try {
    const prevList = cameras.value.slice();
    const prevSig = camerasConfigSignature(prevList);

    await fetchCameras();

    const nextList = cameras.value;
    const nextSig = camerasConfigSignature(nextList);

    // If anything changed (including ordering), rebuild all players.
    if (prevSig === nextSig) return;

    for (const id of new Set([
      ...hlsInstances.value.keys(),
      ...mainHlsInstances.value.keys(),
    ])) {
      destroyPlayersForCamera(id);
    }

    for (const c of cameras.value) c.ready = false;

    await nextTick();
    for (const camera of cameras.value) {
      void setupPlayerForCamera(camera);
    }
  } finally {
    isRefreshInFlight.value = false;
  }
}

async function addCamera() {
  try {
    const isEdit = editingCameraId.value != null;
    const url = isEdit ? `/api/cameras/${editingCameraId.value}` : "/api/cameras";
    const method = isEdit ? "PUT" : "POST";

    const created = await $fetch<Camera>(url, {
      method,
      body: {
        name: form.value.name,
        mainRtspUrl: form.value.mainStreamUrl,
        subRtspUrl: form.value.subStreamUrl,
      },
    });

    form.value = { name: "", mainStreamUrl: "", subStreamUrl: "" };
    showAddForm.value = false;
    editingCameraId.value = null;

    await refreshCamerasAndPlayers();
  } catch (e) {
    console.error("Error adding camera:", e);
    alert(t("app.failedToAddCamera", { error: String(e) }));
  }
}

function openAddForm() {
  editingCameraId.value = null;
  form.value = { name: "", mainStreamUrl: "", subStreamUrl: "" };
  showAddForm.value = true;
}

function openEditForm(camera: Camera) {
  editingCameraId.value = camera.id;
  form.value = {
    name: camera.name,
    mainStreamUrl: camera.mainRtspUrl ?? camera.mainStreamUrl,
    subStreamUrl: camera.subRtspUrl ?? camera.subStreamUrl,
  };
  showAddForm.value = true;
}

function closeAddForm() {
  showAddForm.value = false;
  editingCameraId.value = null;
  form.value = { name: "", mainStreamUrl: "", subStreamUrl: "" };
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
  await refreshCamerasAndPlayers();
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

  await nextTick();
  updateViewport();

  if (typeof ResizeObserver !== "undefined") {
    gridResizeObserver = new ResizeObserver(() => updateViewport());
    if (gridEl.value) gridResizeObserver.observe(gridEl.value);
  }
  window.addEventListener("resize", updateViewport);

  await refreshCamerasAndPlayers();

  pollTimer = setInterval(() => {
    void refreshCamerasAndPlayers();
  }, 10_000);
});

onUnmounted(() => {
  isUnmounted = true;
  window.removeEventListener("resize", updateViewport);
  if (gridResizeObserver) {
    gridResizeObserver.disconnect();
    gridResizeObserver = null;
  }
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  hlsInstances.value.forEach((hls) => hls.destroy());
  mainHlsInstances.value.forEach((hls) => hls.destroy());
});

const shouldHide = ref(false);
const cursorTimeout = ref<number | null>(null);

function handleIdleCursor() {
  shouldHide.value = false;
  if (cursorTimeout.value) clearTimeout(cursorTimeout.value);
  cursorTimeout.value = setTimeout(() => {
    shouldHide.value = true;
  }, 2000);
}
</script>

<template>
  <div
    class="h-screen bg-black text-white flex flex-col"
    @mousemove="handleIdleCursor"
  >
    <div
      class="shrink-0 bg-black/90 duration-200 flex items-center gap-3 px-2 py-2 border-b border-white/10 absolute top-0 inset-x-0 z-10"
      :class="{
        'opacity-0': shouldHide,
      }"
    >
      <div class="font-medium">
        {{ t("app.camerasCount", { count: cameras.length }) }}
      </div>
      <div class="flex-1" />
      <button
        @click="showAddForm ? closeAddForm() : openAddForm()"
        class="px-3 py-1 border border-white/20 hover:border-white/40"
      >
        {{ showAddForm ? t("app.close") : t("app.add") }}
      </button>
    </div>

      <div
        v-if="showAddForm"
        class="fixed inset-0 flex items-center justify-center border-b border-white/10 z-[60] p-4"
      >
        <div
          class="absolute inset-0 bg-black/50 z-40"
          @click="closeAddForm"
        ></div>
      <form
        @submit.prevent="addCamera"
        class="grid grid-cols-1 gap-4 items-end z-50 p-8 bg-black/95 w-full shadow-4xl max-w-2xl"
      >
        <label class="block">
          <div class="text-xs text-white/70 mb-1">{{ t("app.name") }}</div>
          <input
            v-model="form.name"
            type="text"
            required
            class="w-full bg-black border border-white/20 px-2 py-1"
          />
        </label>
        <label class="block">
          <div class="text-xs text-white/70 mb-1">
            {{ t("app.mainRtsp") }}
          </div>
          <input
            v-model="form.mainStreamUrl"
            type="text"
            required
            class="w-full bg-black border border-white/20 px-2 py-1"
          />
        </label>
        <label class="block">
          <div class="text-xs text-white/70 mb-1">{{ t("app.subRtsp") }}</div>
          <input
            v-model="form.subStreamUrl"
            type="text"
            required
            class="w-full bg-black border border-white/20 px-2 py-1"
          />
        </label>
        <div class="flex gap-2">
          <button
            type="submit"
            class="px-3 w-full py-1 border border-white/20 hover:border-white/40"
          >
            {{ t("app.save") }}
          </button>
        </div>
      </form>
    </div>

    <div v-if="cameras.length" class="flex-1 min-h-0">
      <div ref="gridEl" class="grid w-full h-full gap-px" :style="gridStyle">
        <div
          v-for="camera in displayCameras"
          :key="camera.id"
          class="bg-black relative"
          @click="openMainStream(camera)"
        >
          <div
            v-if="!camera.ready"
            class="absolute inset-0 flex items-center justify-center text-white/60 text-sm"
          >
            {{ t("app.loading") }}
          </div>
          <video
            :id="`video-${camera.id}`"
            :style="{ opacity: camera.ready ? 1 : 0 }"
            autoplay
            muted
            class="w-full h-full object-cover"
          />

          <div
            class="absolute left-1 right-1 bottom-1 flex items-center gap-2 text-xs duraion-200"
            :class="{
              'opacity-0': shouldHide,
            }"
          >
            <div class="flex-1 truncate bg-black/60 px-1 py-0.5">
              {{ camera.name }}
            </div>
            <button
              @click.stop="openEditForm(camera)"
              class="bg-black/60 px-1 py-0.5 border border-white/10 hover:border-white/30"
            >
              {{ t("app.edit") }}
            </button>
            <!-- <button -->
            <!--   @click.stop="setFeaturedCamera(camera.id)" -->
            <!--   class="bg-black/60 px-1 py-0.5 border border-white/10 hover:border-white/30" -->
            <!--   :class=" -->
            <!--     camera.id === effectiveFeaturedCameraId ? 'border-white/60' : '' -->
            <!--   " -->
            <!--   :title="t('app.makeLarge')" -->
            <!-- > -->
            <!--   {{ t("app.large") }} -->
            <!-- </button> -->
            <button
              @click.stop="deleteCamera(camera.id)"
              class="bg-black/60 px-1 py-0.5 border border-white/10 hover:border-white/30"
            >
              {{ t("app.delete") }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <div
      v-else
      class="flex-1 min-h-0 grid place-items-center text-white/60 text-sm"
    >
      {{ t("app.noCameras") }}
    </div>

    <Teleport to="body">
      <div
        v-if="selectedCamera"
        class="fixed inset-0 bg-black/95 text-white z-50 flex items-center justify-center"
        @click="closeMainStream"
      >
        <div class="w-full h-full flex flex-col">
          <div
            class="flex justify-between items-center absolute top-0 inset-x-0 p-2 z-20"
          >
            <h2 class="text-sm">{{ selectedCamera.name }}</h2>
            <button
              @click="closeMainStream"
              class="px-2 py-1 border border-white/20 hover:border-white/40"
            >
              {{ t("app.close") }}
            </button>
          </div>
          <div class="flex-1 bg-black relative z-10">
            <video
              :id="`main-video-${selectedCamera.id}`"
              autoplay
              muted
              class="w-full h-full object-contain max-h-screen"
            />
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
