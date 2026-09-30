# Builds the kill-streak announcer clips assets/audio/announcer/<line>_0.ogg from two CC0 Kenney voice-over packs.
# Run headless with Blender (it bundles numpy + audaspace with an OGG/Vorbis encoder), from Projects/throneshard:
#   ~/.local/bin/blender -b --python tools/scripts/audio/build_announcer_lines.py -- [download_dir=/tmp/throneshard_dl]
# Packs are downloaded if missing. The spoken words are the nearest fit in the packs, not the banner text: the packs have
# no "Killing Spree" or "Dominating", so each tier gets a short shout of about the right weight (see assets/audio/CREDITS.txt).
import os, sys, zipfile, urllib.request
import numpy as np
import aud

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
DL = ARGS[0] if ARGS else '/tmp/throneshard_dl'
OUT = os.path.abspath(os.path.join(os.getcwd(), 'assets', 'audio', 'announcer'))
RATE = 22050
PACKS = {
    'fighter': 'https://opengameart.org/sites/default/files/kenney_voiceoverFighter.zip',
    'voiceover': 'https://kenney.nl/media/pages/assets/voiceover-pack/3f7f168698-1677589897/kenney_voiceover-pack.zip',
}
# announcer line -> (pack, file)
LINES = {
    'first_blood': ('fighter', 'kill_him.ogg'),
    'double_kill': ('fighter', 'combo.ogg'),
    'triple_kill': ('fighter', 'multi_kill.ogg'),
    'quad_kill': ('voiceover', 'Male/power_up.ogg'),
    'massacre': ('fighter', 'deathmatch.ogg'),
    'killing_spree': ('voiceover', 'Male/war_go_go_go.ogg'),
    'dominating': ('fighter', 'sudden_death.ogg'),
    'relentless': ('fighter', 'kill_it.ogg'),
    'unstoppable': ('fighter', 'final_round.ogg'),
    'merciless': ('voiceover', 'Male/war_target_engaged.ogg'),
    'ruthless': ('fighter', 'flawless_victory.ogg'),
    'legendary': ('fighter', 'championship_mode.ogg'),
    'mythic': ('voiceover', 'Male/new_highscore.ogg'),
    'shutdown': ('fighter', 'combo_breaker.ogg'),
}


def ensure(pack):
    dst = os.path.join(DL, pack)
    if not os.path.exists(dst):
        os.makedirs(DL, exist_ok=True)
        tmp = dst + '.zip'
        urllib.request.urlretrieve(PACKS[pack], tmp)
        with zipfile.ZipFile(tmp) as z:
            z.extractall(dst)
    return dst


def find(pack, rel):
    for dp, _, fs in os.walk(ensure(pack)):
        for f in fs:
            p = os.path.join(dp, f).replace('\\', '/')
            if p.endswith('/' + rel) or p.endswith(rel):
                return p
    raise FileNotFoundError(pack + ':' + rel)


def load(path):
    d = aud.Sound(path).rechannel(1).resample(RATE, False).data()
    return (d[:, 0] if d.ndim > 1 else d).astype(np.float32)


def process(x, fade=0.03, peak=0.89):
    idx = np.where(np.abs(x) > np.abs(x).max() * 0.01)[0]
    x = x[max(0, idx[0] - int(0.01 * RATE)):min(len(x), idx[-1] + int(0.04 * RATE))]
    x = x - x.mean()
    n = min(len(x) // 3, int(fade * RATE))
    x[:max(1, n // 6)] *= np.linspace(0, 1, max(1, n // 6))
    x[-n:] *= np.linspace(1, 0, n)
    return (x * (peak / np.abs(x).max())).astype(np.float32)


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    for name, (pack, rel) in LINES.items():
        x = process(load(find(pack, rel)))
        p = os.path.join(OUT, f'{name}_0.ogg')
        aud.Sound.buffer(x.reshape(-1, 1), RATE).write(p, RATE, aud.CHANNELS_MONO, aud.FORMAT_S16, aud.CONTAINER_OGG, aud.CODEC_VORBIS, 56000)
        print(f'{name}: {len(x) / RATE:.2f}s {os.path.getsize(p) // 1024}KB  <- {pack}/{rel}')
