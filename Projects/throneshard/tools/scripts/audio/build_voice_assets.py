# Builds hero voice / announcer / creature clips in public/assets/audio/{voice,announcer,creature}/ from CC0 packs.
# Run headless with Blender (bundles numpy + audaspace with an OGG/Vorbis encoder):
#   ~/.local/bin/blender -b --python scripts/audio/build_voice_assets.py -- [download_dir=/tmp/ws4/dl]
# Missing source packs are downloaded automatically. Every source + license is listed in public/assets/audio/CREDITS.txt.
import os, sys, zipfile, urllib.request
import numpy as np
import aud

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
DL = ARGS[0] if ARGS else '/tmp/ws4/dl'
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'public', 'assets', 'audio')
RATE = 22050

PACKS = {  # local folder -> (url, is_zip)   all CC0
    'kenney_voiceoverFighter': ('https://opengameart.org/sites/default/files/kenney_voiceoverFighter.zip', True),
    'kenney_voiceover': ('https://kenney.nl/media/pages/assets/voiceover-pack/3f7f168698-1677589897/kenney_voiceover-pack.zip', True),
    '80-CC0-creature-SFX_0': ('https://opengameart.org/sites/default/files/80-CC0-creature-SFX_0.zip', True),
    'all_orc_commander_audio_files_0': ('https://opengameart.org/sites/default/files/all_orc_commander_audio_files_0.zip', True),
    'all_demon_lord_audio_files_0': ('https://opengameart.org/sites/default/files/all_demon_lord_audio_files_0.zip', True),
    'rpg_voice': ('https://opengameart.org/sites/default/files/RPG%20Voice%20Starter%20Pack.zip', True),
    'yell': ('https://opengameart.org/sites/default/files/yelling%20sounds.zip', True),
    'hit5': ('https://opengameart.org/sites/default/files/5Hit_Sounds.zip', True),
    'female_hurt_grunts_groans_1.ogg': ('https://opengameart.org/sites/default/files/female_hurt_grunts_groans_1.ogg', False),
}


def ensure(name):
    url, is_zip = PACKS[name]
    dst = os.path.join(DL, name)
    if os.path.exists(dst):
        return dst
    os.makedirs(DL, exist_ok=True)
    tmp = dst + ('.zip' if is_zip else '')
    print('download', url)
    urllib.request.urlretrieve(url, tmp)
    if is_zip:
        with zipfile.ZipFile(tmp) as z:
            z.extractall(dst)
    return dst


def find(pack, rel):
    base = ensure(pack)
    for dp, _, fs in os.walk(base):
        for f in fs:
            p = os.path.join(dp, f)
            if p.replace('\\', '/').endswith(rel):
                return p
    raise FileNotFoundError(pack + ':' + rel)


def load(path):
    s = aud.Sound(path).rechannel(1).resample(RATE, False)
    d = s.data()
    return (d[:, 0] if d.ndim > 1 else d).astype(np.float32)


def process(x, start=None, end=None, fade=0.03, peak=0.89, pad=0.01):
    if start is not None or end is not None:
        a = int((start or 0) * RATE)
        b = int(end * RATE) if end else len(x)
        x = x[a:b]
    # trim silence (-40 dB rel. to peak) with a small pad
    env = np.abs(x)
    thr = env.max() * 0.01
    idx = np.where(env > thr)[0]
    if len(idx):
        a = max(0, idx[0] - int(pad * RATE))
        b = min(len(x), idx[-1] + int(pad * RATE * 4))
        x = x[a:b]
    x = x - x.mean()
    n = min(len(x) // 3, int(fade * RATE))
    if n > 0:
        x[:max(1, n // 6)] *= np.linspace(0, 1, max(1, n // 6))
        x[-n:] *= np.linspace(1, 0, n)
    m = np.abs(x).max()
    if m > 0:
        x = x * (peak / m)
    return x.astype(np.float32)


def write(x, rel):
    p = os.path.join(OUT, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    snd = aud.Sound.buffer(x.reshape(-1, 1), RATE)
    snd.write(p, RATE, aud.CHANNELS_MONO, aud.FORMAT_S16, aud.CONTAINER_OGG, aud.CODEC_VORBIS, 56000)
    print(f'  {rel}  {len(x) / RATE:.2f}s  {os.path.getsize(p) // 1024}KB')


ORC, DEM, RPG, YELL = 'all_orc_commander_audio_files_0', 'all_demon_lord_audio_files_0', 'rpg_voice', 'yell'
T1, T2, T3 = 'Type 1/', 'Type 2/', 'Type 3/'
FEM = 'female_hurt_grunts_groans_1.ogg'

# out name -> list of (pack, relpath, start, end)
CLIPS = {
    # ---- male voice sets (used by heroes; unknown heroes hash into these) ----
    'voice/orc/cast': [(ORC, 'ORC FIGHT.wav'), (ORC, 'ORC FIGHT 2.wav'), (ORC, 'ORC FIGHT 3.wav'), (ORC, 'ORC GRUNT 2.wav')],
    'voice/orc/ult': [(ORC, 'ORC LAUGH.wav', 0.6, 2.5)],
    'voice/orc/death': [(ORC, 'ORC DIES.wav', 1.85, 2.62), (ORC, 'ORC DIES.wav', 3.0, 3.85)],
    'voice/brute/cast': [(ORC, 'ORC GRUNT 3.wav', 0.05, 0.82), (ORC, 'ORC GRUNT 4.wav'), (DEM, 'DL DEMON SNARL 3.wav')],
    'voice/brute/ult': [(DEM, 'DL DINNERTIME.wav')],
    'voice/brute/death': [(ORC, 'ORC DIES.wav', 4.1, 5.1)],
    'voice/demon/cast': [(DEM, 'DL DEMON FIGHT GRUNT 1.wav'), (DEM, 'DL DEMON FIGHT GRUNT 2.wav'), (DEM, 'DL DEMON FIGHT GRUNT 3.wav', 0.5, 1.95)],
    'voice/demon/ult': [(DEM, 'DL DEMON MOOHAAA LAUGH.wav', 1.3, 3.2)],
    'voice/demon/death': [(DEM, 'DL DEMON DIES.wav', 1.8, 2.8)],
    'voice/revenant/cast': [(DEM, 'DL DEMON SNIGGER 1.wav'), (DEM, 'DL DEMON SNARL 2.wav', 0.1, 1.3), (DEM, 'DL DEMON SNIGGER 2.wav', 0.1, 1.2)],
    'voice/revenant/ult': [(DEM, 'DL DEMON LAUGHS.wav', 1.3, 2.9)],
    'voice/revenant/death': [(DEM, 'DL DEMON DIES.wav', 3.55, 4.75)],
    'voice/male1/cast': [(YELL, '1yell4.wav'), (YELL, '1yell5.wav'), (YELL, '1yell12.wav'), (YELL, '1yell10.wav')],
    'voice/male1/death': [(YELL, '1yell3.wav'), (YELL, '1yell11.wav')],
    'voice/male2/cast': [(YELL, '2yell1.wav'), (YELL, '2yell9.wav'), (YELL, '2yell10.wav')],
    'voice/male2/death': [(YELL, '2yell7.wav'), (YELL, '2yell11.wav')],
    'voice/male3/cast': [(YELL, '3grunt4.wav'), (YELL, '3grunt5.wav'), (YELL, '3yell3.wav'), (YELL, '3yell4.wav')],
    'voice/male3/ult': [(YELL, '3yell12.wav')],
    'voice/male3/death': [(YELL, '3yell9.wav', 0.3, 1.95)],
    'voice/male0/cast': [(YELL, 'yell12.wav'), (YELL, 'yell13.wav'), (YELL, 'yell7.wav')],
    'voice/male0/ult': [(YELL, 'yell4.wav')],
    'voice/male0/death': [(YELL, 'yell2.wav'), ('hit5', 'ogg/die1.ogg')],
    # ---- female voice sets ----
    'voice/fem1/cast': [(RPG, T1 + 'freeze.wav'), (RPG, T1 + 'ice.wav'), (RPG, T1 + 'attack2.wav')],
    'voice/fem1/ult': [(RPG, T1 + 'blizzard.wav')],
    'voice/fem1/grunt': [(RPG, T1 + 'attack1.wav'), (RPG, T1 + 'attack3.wav'), (RPG, T1 + 'jump1.wav')],
    'voice/fem1/death': [(FEM, '', 4.9, 6.15), (RPG, T1 + 'damaged2.wav')],
    'voice/fem2/cast': [(RPG, T2 + 'fire.wav'), (RPG, T2 + 'burn.wav'), (RPG, T2 + 'attack1.wav')],
    'voice/fem2/ult': [(RPG, T2 + 'hellstorm.wav')],
    'voice/fem2/grunt': [(RPG, T2 + 'attack2.wav'), (RPG, T2 + 'attack3.wav')],
    'voice/fem2/death': [(FEM, '', 7.25, 8.1), (RPG, T2 + 'damaged2.wav')],
    'voice/fem3/cast': [(RPG, T3 + 'attack1.wav'), (RPG, T3 + 'wind.wav'), (RPG, T3 + 'attack3.wav')],
    'voice/fem3/ult': [(RPG, T3 + 'freeze.wav')],
    'voice/fem3/grunt': [(RPG, T3 + 'attack2.wav'), (RPG, T3 + 'jump2.wav')],
    'voice/fem3/death': [(FEM, '', 9.3, 10.3), (RPG, T3 + 'damaged3.wav')],
    # ---- announcer (Kenney voiceover packs) ----
    'announcer/fight': [('kenney_voiceoverFighter', 'Audio/fight.ogg')],
    'announcer/prepare': [('kenney_voiceoverFighter', 'Audio/prepare_yourself.ogg')],
    'announcer/multi_kill': [('kenney_voiceoverFighter', 'Audio/multi_kill.ogg')],
    'announcer/you_win': [('kenney_voiceoverFighter', 'Audio/you_win.ogg')],
    'announcer/you_lose': [('kenney_voiceoverFighter', 'Audio/you_lose.ogg')],
    'announcer/target_destroyed': [('kenney_voiceover', 'Male/war_target_destroyed.ogg')],
    'announcer/objective': [('kenney_voiceover', 'Male/objective_achieved.ogg')],
    'announcer/look_out': [('kenney_voiceover', 'Male/war_look_out.ogg')],
    'announcer/level_up': [('kenney_voiceover', 'Male/level_up.ogg')],
    # ---- creatures ----
    'creature/roar': [('80-CC0-creature-SFX_0', 'roar_02.ogg'), ('80-CC0-creature-SFX_0', 'roar_03.ogg'), ('80-CC0-creature-SFX_0', 'monster_04.ogg')],
}

if __name__ == '__main__':
    total = 0
    for name, srcs in CLIPS.items():
        for i, s in enumerate(srcs):
            pack, rel = s[0], s[1]
            path = os.path.join(ensure(pack)) if not rel else find(pack, rel)
            x = load(path)
            x = process(x, s[2] if len(s) > 2 else None, s[3] if len(s) > 3 else None)
            rel_out = f'{name}_{i}.ogg'
            write(x, rel_out)
            total += os.path.getsize(os.path.join(OUT, rel_out))
    print(f'total {total / 1024:.0f} KB')
