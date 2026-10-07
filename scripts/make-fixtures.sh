#!/usr/bin/env bash
# Regenerates the media fixtures used by the tests (needs ffmpeg with
# libvorbis, libopus, libmp3lame, libvpx, libx264, libwebp, libaom).
set -euo pipefail
cd "$(dirname "$0")/../tests/fixtures"
ff() { ffmpeg -hide_banner -loglevel error -y "$@"; }
TONE=(-f lavfi -i "sine=frequency=440:duration=2")
VID=(-f lavfi -i "testsrc=duration=2:size=160x120:rate=25" -f lavfi -i "sine=frequency=440:duration=2")

ff "${TONE[@]}" -ac 2 -c:a libvorbis tone.ogg
ff "${TONE[@]}" -ac 2 -c:a mp2 tone.mp2
ff "${TONE[@]}" -c:a libmp3lame -b:a 128k tone.mp3
cp tone.mp3 tone-as.mpeg
ff "${TONE[@]}" -c:a libopus tone.opus
ff "${TONE[@]}" -c:a flac tone.flac
ff "${TONE[@]}" -c:a aac tone.aac
ff "${VID[@]}" -c:v mpeg1video -c:a mp2 -shortest clip.mpeg
ff "${VID[@]}" -c:v mpeg2video -c:a libmp3lame -f mpeg -shortest clip-mp3audio.mpg
ff "${VID[@]}" -c:v mpeg2video -c:a mp2 -f mpegts -shortest clip.ts
ff "${VID[@]}" -c:v libvpx -c:a libopus -shortest clip.webm
ff "${VID[@]}" -c:v libx264 -c:a aac -shortest clip.mp4
ff -f lavfi -i "testsrc=duration=1:size=64x48:rate=1" -frames:v 1 img.png
ff -i img.png -c:v libwebp img.webp
ff -i img.png img.gif
ff -i img.png img.bmp
ff -i img.png -c:v libaom-av1 -still-picture 1 img.avif
echo "fixtures regenerated"
