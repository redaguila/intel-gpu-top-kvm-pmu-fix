# Intel GPU Top PMU detection fix for KVM GPU passthrough

A tested workaround for `intel_gpu_top` reporting **"Failed to detect engines!"** when an Intel integrated GPU is passed through to a KVM/QEMU guest at a nonstandard PCI address. Includes Jellyfin Docker / Intel Quick Sync troubleshooting.

> **Scope:** Tested on Ubuntu Resolute (26.04), kernel `7.0.0-42-generic`, Intel GPU Tools `2.3-1`, Intel Arrow Lake-P GPU (PCI ID `8086:7d51`), guest PCI slot `0000:00:10.0`, `i915` driver. This is a local workaround, not an upstream-approved fix.

## Symptom

```console
$ sudo intel_gpu_top -d pci:vendor=8086,device=7d51
Failed to detect engines! (No such file or directory)
(Kernel 4.16 or newer is required for i915 PMU support.)
```

The kernel-version hint is misleading here. The kernel exposed working i915 performance counters, but the userspace tool looked in the wrong PMU directory.

## Root cause

In this KVM guest, the integrated Intel GPU appears at `0000:00:10.0`, rather than the conventional integrated-GPU slot `0000:00:02.0`. Intel GPU Tools 2.3 chooses a PCI-specific PMU name when the GPU is not at the conventional slot.

`strace` revealed the failing lookup:

```text
/sys/devices/i915_0000_00_10.0/events  -> ENOENT
```

The actual PMU directory was:

```text
/sys/devices/i915/events
```

Check the kernel PMU before modifying anything:

```bash
ls /sys/bus/event_source/devices/i915/events/
sudo perf stat -a -e i915/rcs0-busy/ -e i915/bcs0-busy/ -e i915/vcs0-busy/ -- sleep 3
```

In the tested VM, `perf` successfully opened these counters, confirming the driver/PMU worked.

## Workaround: patch Intel GPU Tools 2.3

The change makes `intel_gpu_top` try the PCI-specific PMU path first, then fall back to the generic `i915` PMU path if the first path does not exist.

### 1. Get the source and dependencies

Enable Ubuntu source repositories (`deb-src`) if `apt source` or `apt build-dep` reports they are unavailable.

```bash
mkdir -p ~/intel-gpu-fix
cd ~/intel-gpu-fix
apt source intel-gpu-tools
sudo apt build-dep intel-gpu-tools
cd intel-gpu-tools-2.3
```

### 2. Apply the patch

Download `patches/intel-gpu-top-pmu-fallback.patch` from this repository, then, from inside `intel-gpu-tools-2.3`:

```bash
cp tools/intel_gpu_top.c tools/intel_gpu_top.c.backup
patch -p1 < /path/to/intel-gpu-top-pmu-fallback.patch
```

If the patch does not apply, confirm the source version is 2.3. Do not force it onto a different version without reviewing the source.

### 3. Compile

```bash
meson setup build --buildtype=release
ninja -C build tools/intel_gpu_top
```

**Important:** The Ninja target is `tools/intel_gpu_top`, not `intel_gpu_top`. The latter produced `unknown target 'intel_gpu_top'` on the tested build.

### 4. Test

```bash
sudo ./build/tools/intel_gpu_top -d pci:vendor=8086,device=7d51
```

On the tested VM this successfully displayed the GPU engines, including Video engine utilization and an `ffmpeg` process. The tool labeled the GPU "Intel Meteorlake (Gen12)" despite the Arrow Lake-P hardware; that label did not prevent monitoring.

### 5. Optional: keep a separate executable

```bash
sudo install -m 755 ./build/tools/intel_gpu_top /usr/local/bin/intel_gpu_top-patched
sudo /usr/local/bin/intel_gpu_top-patched -d pci:vendor=8086,device=7d51
```

This preserves Ubuntu's package-managed `/usr/bin/intel_gpu_top`.

## Jellyfin Docker / Quick Sync notes

In the same VM, Jellyfin used `lscr.io/linuxserver/jellyfin:latest`. The container already had `/dev/dri` mapped into it; this was verified using:

```bash
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'
docker inspect jellyfin --format '{{json .HostConfig.Devices}}'
docker exec jellyfin ls -l /dev/dri/
```

The container exposed `card0`, `card1`, and `renderD128`. The Intel render node was `/dev/dri/renderD128`.

In Jellyfin's **Dashboard → Playback → Transcoding**, select **Intel Quick Sync (QSV)** and configure the correct render device. Check supported decode/encode options rather than enabling unsupported codecs.

```bash
docker exec jellyfin /usr/lib/jellyfin-ffmpeg/ffmpeg -hide_banner -hwaccels
docker exec jellyfin /usr/lib/jellyfin-ffmpeg/ffmpeg -hide_banner -encoders 2>/dev/null | grep -E 'h264_qsv|hevc_qsv|av1_qsv'
```

These commands confirm FFmpeg build capabilities, **not** successful runtime QSV initialization. To verify actual transcoding, play media at a reduced bitrate/resolution, confirm Jellyfin says **Transcoding**, inspect the session's FFmpeg log for QSV use, and watch Video engine activity with the patched `intel_gpu_top`.

**Remuxing is not transcoding.** One tested HEVC Main 10 / HDR10 movie was remuxed with HEVC and AAC both marked "direct"; this normally does not require GPU video re-encoding. The user subsequently reported success with the setup, but a final QSV transcoding log was not preserved.

### Docker permissions

The host `render` group had GID 991 on the tested system, but this value varies. `docker exec jellyfin id` showed the shell executing as root; it does **not** prove the actual Jellyfin service process has access to the render node. If QSV fails, inspect the process UID, GIDs, container group access, and FFmpeg logs before changing permissions.

## Troubleshooting

| Problem | Check |
| --- | --- |
| `Failed to detect engines!` | Compare PMU directory requested by `strace` against `/sys/bus/event_source/devices/` |
| `unknown target 'intel_gpu_top'` | Use `ninja -C build tools/intel_gpu_top` |
| `jellyfin.service not found` | Jellyfin may be running in Docker rather than as a host systemd service |
| `/dev/dri/renderD128` missing inside container | Verify Docker device mapping |
| QSV available in FFmpeg but transcode fails | Check actual process permissions, media drivers, and Jellyfin FFmpeg logs |
| No GPU activity while remuxing | Expected when compressed video is passed through unchanged |

## Limitations

- The fallback assumes the generic `i915` PMU corresponds to the GPU being monitored. **On systems with multiple Intel GPUs, that assumption may be wrong.** Do not apply blindly.
- The patch was tested against Intel GPU Tools 2.3; newer source versions may differ.
- No kernel, i915 driver, or GPU passthrough changes were needed for the monitoring fix.
- The Intel GPU Tools source remains under its upstream license. This repository documents a small source patch and reproduction steps.
