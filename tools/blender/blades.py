"""Blade designs: every blade as data, and the builder that turns a design into Blender objects.
Run through build_blades.py (see its header).

Part names are roles the game paints:  base (dark), blades (main colour), crown (light blades on top), inlay (accent,
emissive), plates_a / plates_b (the chunky ring round the emblem, alternating), bezel (dark metal), ticks (light)."""
import math
from blade_geo import TAU, armor_layer, lathe, plate_ring, shard_layer, spiky_base, ticks

Z0 = 0.30                  # the base plate's underside: the weight disc and tip hang below this
DZ_BASE, DZ_BLADE, DZ_CROWN = 0.09, 0.10, 0.11


def build_blade(bid, d):
    n = d['n']
    parts = {}
    zb = Z0 + DZ_BASE
    # the dark base plate with the jagged rim
    parts['base'] = spiky_base('base', d.get('base_n', n), 0.0, d.get('base_r', 0.97), d.get('base_depth', 0.12),
                               Z0, DZ_BASE, p=d.get('base_p', 1.7), tp=d.get('base_tp', 0.78), cw=d.get('base_cw', 0.07))
    kind = d.get('kind', 'swept')
    nb, nc = d.get('blade_n', n), d.get('crown_n', n)
    if kind == 'armor':
        # Defense: angular armour plates in two layers
        b = dict(r0=0.50, r1=0.98, a0=0.0, hw0=0.30, hw1=0.42, cut=0.12, skew=0.15)
        b.update(d.get('blade', {}))
        parts['blades'] = armor_layer('blades', nb, zb, DZ_BLADE, phase=d.get('blade_phase', 0.0), **b)
        c = dict(r0=0.56, r1=0.92, a0=0.0, hw0=0.22, hw1=0.30, cut=0.09, skew=0.12)
        c.update(d.get('crown', {}))
        parts['crown'] = armor_layer('crown', nc, zb + DZ_BLADE, DZ_CROWN, phase=d.get('crown_phase', TAU / nb * 0.5), taper=0.1, **c)
        i = dict(c)
        i.update(hw0=c['hw0'] * 0.5, hw1=c['hw1'] * 0.5, r0=c['r0'] + 0.05, r1=c['r1'] - 0.08, cut=0.04)
        i.update(d.get('inlay', {}))
        parts['inlay'] = armor_layer('inlay', nc, zb + DZ_BLADE + DZ_CROWN, 0.014, phase=d.get('crown_phase', TAU / nb * 0.5), taper=0.0, bevel=0.003, **i)
    else:
        # layer B: the big swept blades in the main colour
        b = dict(r0=0.50, r1=0.99, a0=0.0, sweep=0.9, hw=0.27, gam=1.0, pw=2.0, qw=0.8, lead=0.7, notch=0.0, nz=4)
        b.update(d.get('blade', {}))
        parts['blades'] = shard_layer('blades', nb, zb, DZ_BLADE, phase=d.get('blade_phase', 0.0), taper=0.06, **b)
        # layer C: the long jagged blades on top
        c = dict(r0=0.56, r1=1.02, a0=0.0, sweep=1.1, hw=0.21, gam=1.0, pw=1.8, qw=0.8, lead=0.55, notch=0.12, nz=5)
        c.update(d.get('crown', {}))
        parts['crown'] = shard_layer('crown', nc, zb + DZ_BLADE, DZ_CROWN, phase=d.get('crown_phase', TAU / nb * 0.5), taper=0.08, **c)
        # inlay: a slimmer shard let into the top of each crown blade
        i = dict(c)
        i.update(hw=c['hw'] * 0.30, r0=c['r0'] + 0.06, r1=c['r1'] - 0.12, notch=c['notch'] * 0.4, lead=0.8)
        i.update(d.get('inlay', {}))
        parts['inlay'] = shard_layer('inlay', nc, zb + DZ_BLADE + DZ_CROWN, 0.014, phase=d.get('crown_phase', TAU / nb * 0.5), taper=0.0, bevel=0.003, **i)
    # a smooth outer rim (Stamina blades keep a round silhouette)
    if d.get('rim'):
        r0, r1, h = d['rim']
        parts['rim'] = lathe('rim', [(r0, Z0 + 0.01), (r1, Z0 + 0.01), (r1, Z0 + h), (r1 - 0.02, Z0 + h + 0.02), (r0 + 0.02, Z0 + h + 0.02), (r0, Z0 + h)], 96, bevel=0.004)
    # the ring of plates round the emblem disc
    m = d.get('plates', 8)
    r0, r1 = d.get('plate_r', (0.36, 0.50))
    ph = d.get('plate_h', 0.19)
    parts['plates_a'] = plate_ring('plates_a', m, r0, r1, zb, ph, pick=lambda k: k % 2 == 0)
    parts['plates_b'] = plate_ring('plates_b', m, r0, r1, zb, ph, pick=lambda k: k % 2 == 1)
    # the bezel round the emblem
    parts['bezel'] = lathe('bezel', [(0.285, zb), (0.37, zb), (0.37, zb + 0.23), (0.35, zb + 0.265), (0.30, zb + 0.265), (0.285, zb + 0.25)], 64, bevel=0.004)
    parts['ticks'] = ticks('ticks', 36, 0.335, zb + 0.265, length=0.034, width=0.012, height=0.010)
    return parts


# ---------------------------------------------------------------------------------------------- the designs
def C(main, mid, accent, trim, alt=None):
    return dict(main=main, dark=mid, accent=accent, trim=trim, alt=alt)


ATTACK = dict(
    ravok=dict(  # Heavy Striker: five hooked, saw-edged blades
        n=5, base_n=10, base_depth=0.10, plates=8,
        blade=dict(sweep=0.95, hw=0.27, notch=0.10, nz=3),
        crown=dict(sweep=1.15, hw=0.20, notch=0.16, nz=5),
        colors=C('#d3151b', '#0e1015', '#ff8a1f', '#2b2f3a')),
    blazefang=dict(  # Burst Attacker: four wide blades with flame-wave edges
        n=4, base_n=8, base_depth=0.12, plates=8,
        blade=dict(sweep=0.8, hw=0.33, wave=0.06, wave_n=2, lead=0.8),
        crown=dict(sweep=1.0, hw=0.25, wave=0.08, wave_n=3, lead=0.7),
        colors=C('#ff7a1f', '#4a0f0a', '#ffd23a', '#3a1f1f')),
    riftclaw=dict(  # Precision Attacker: three long hooked claws
        n=3, base_n=3, base_depth=0.16, plates=6, plate_h=0.16,
        blade=dict(sweep=1.55, hw=0.25, pw=1.7, hook=0.7, lead=0.8, gam=1.1),
        crown=dict(sweep=1.85, hw=0.15, pw=1.5, hook=0.9, notch=0.05, nz=3, gam=1.1),
        colors=C('#eef1f7', '#101218', '#ff3d8b', '#2a2330')),
    **{'volt-reaper': dict(  # Speed Attacker: six blades with big lightning zigzags
        n=6, base_n=12, base_depth=0.08, plates=12, plate_h=0.16,
        blade=dict(sweep=0.8, hw=0.22, notch=0.12, nz=4),
        crown=dict(sweep=1.0, hw=0.21, notch=0.24, nz=3),
        colors=C('#f4e216', '#12151c', '#fff35a', '#1d2433')),
    'titan-breaker': dict(  # Heavy Destroyer: four massive axe-head blades
        n=4, base_n=8, base_depth=0.08, plates=8, plate_h=0.24,
        blade=dict(sweep=0.55, hw=0.46, pw=4.0, qw=0.6, lead=0.95, r0=0.5, r1=0.90),
        crown=dict(sweep=0.75, hw=0.30, pw=3.0, qw=0.6, lead=0.9, notch=0.07, nz=2, r1=0.91),
        colors=C('#b5702a', '#22242c', '#ff8a3a', '#3a3f4a')),
    'inferno-x': dict(  # Sustained Attacker: six flame blades
        n=6, base_n=6, base_depth=0.10, plates=8,
        blade=dict(sweep=0.9, hw=0.26, wave=0.06, wave_n=3, notch=0.05),
        crown=dict(sweep=1.1, hw=0.20, wave=0.07, wave_n=4, notch=0.08, nz=4),
        colors=C('#b8101f', '#1c0a0d', '#ff9a2e', '#40201a')),
    'stormfang': dict(  # Combo Attacker: six slender wind fangs
        n=6, base_n=12, base_depth=0.09, plates=10, plate_h=0.17,
        blade=dict(sweep=1.3, hw=0.20, gam=1.15, notch=0.05, nz=6),
        crown=dict(sweep=1.5, hw=0.15, gam=1.15, hook=0.3, notch=0.08, nz=6),
        colors=C('#1d5fd6', '#0a1230', '#4fd8ff', '#28303f'))},
)

DEFENSE = {
    'gravion': dict(  # Heavy Tank: broad armour, ten chunky plates
        kind='armor', n=6, base_n=6, base_depth=0.05, base_r=0.98, plates=10, plate_h=0.22,
        blade=dict(hw0=0.26, hw1=0.36, cut=0.12, skew=0.14),
        crown=dict(hw0=0.20, hw1=0.27, cut=0.09, skew=0.12),
        colors=C('#1c9c8c', '#0f1a22', '#38d6b8', '#222c45', '#eef4f6')),
    'iron-warden': dict(  # Counter Defender: wide flat shield plates
        kind='armor', n=6, base_n=6, base_depth=0.04, base_r=0.98, plates=8, plate_h=0.22,
        blade=dict(hw0=0.30, hw1=0.44, cut=0.07, skew=0.10, tipw=0.85),
        crown=dict(hw0=0.22, hw1=0.31, cut=0.06, skew=0.08, tipw=0.85, r1=0.90),
        colors=C('#7d838f', '#2a2118', '#ffc94a', '#2a2f45', '#3b3f4a')),
    'bastion-x': dict(  # Fortress: eight plates with battlements
        kind='armor', n=8, base_n=8, base_depth=0.03, base_r=0.99, plates=8, plate_h=0.27,
        blade=dict(hw0=0.20, hw1=0.30, cut=0.10, skew=0.05, merlons=3, tipw=0.9),
        crown=dict(hw0=0.16, hw1=0.22, cut=0.06, skew=0.04, r1=0.88),
        colors=C('#eaf0fc', '#1c2a54', '#9ec2ff', '#1f2a4a')),
    'stonecore': dict(  # Immovable Tank: five rough boulders
        kind='armor', n=5, base_n=5, base_depth=0.03, base_r=0.97, plates=10, plate_h=0.28,
        blade=dict(hw0=0.36, hw1=0.50, cut=0.18, skew=0.04, jitter=0.09, tipw=0.7, seed=3),
        crown=dict(hw0=0.26, hw1=0.34, cut=0.13, skew=0.04, jitter=0.12, tipw=0.7, r1=0.90, seed=11),
        colors=C('#8c6a46', '#4a3a2a', '#ff8a2a', '#2c3550', '#5a4630')),
    'aegiron': dict(  # Energy Defender: three huge shield wings
        kind='armor', n=3, base_n=3, base_depth=0.05, base_r=0.98, plates=6, plate_h=0.22,
        blade=dict(hw0=0.55, hw1=0.78, cut=0.16, skew=0.20, tipw=0.8),
        crown=dict(hw0=0.38, hw1=0.50, cut=0.12, skew=0.18, tipw=0.7, r1=0.90),
        colors=C('#1766e0', '#0c2a66', '#36e6ff', '#1b2b55', '#e8f6ff')),
    'guardian-prime': dict(  # Balanced Defender: four medium plates
        kind='armor', n=4, base_n=4, base_depth=0.05, base_r=0.98, plates=8, plate_h=0.21,
        blade=dict(hw0=0.40, hw1=0.58, cut=0.14, skew=0.18, tipw=0.6),
        crown=dict(hw0=0.28, hw1=0.38, cut=0.10, skew=0.16, tipw=0.6, r1=0.91),
        colors=C('#b3bdd3', '#1f3a8a', '#d7e0f5', '#26304f')),
    'gravity-rex': dict(  # Arena Controller: seven spiralled plates
        kind='armor', n=7, base_n=7, base_depth=0.06, base_r=0.98, plates=7, plate_h=0.2,
        blade=dict(hw0=0.22, hw1=0.30, cut=0.14, skew=0.34, tipw=0.4),
        crown=dict(hw0=0.17, hw1=0.22, cut=0.10, skew=0.30, tipw=0.4, r1=0.91),
        colors=C('#6a2fc9', '#1a1238', '#b072ff', '#1d2347')),
}

STAMINA = {
    'phantom': dict(  # Evasive Spinner: three thin crescents
        n=3, base_n=3, base_depth=0.06, plates=6, plate_h=0.16,
        blade=dict(sweep=1.55, hw=0.19, pw=1.6, qw=0.9, lead=0.9, notch=0.0, gam=1.2),
        crown=dict(sweep=1.9, hw=0.15, pw=1.5, qw=0.95, lead=0.9, notch=0.0, gam=1.25),
        colors=C('#19b9e0', '#3a1d7a', '#27e0ff', '#2a1650')),
    'voidrunner': dict(  # Speed Spinner: four slim fins inside a thin rim
        n=4, base_n=4, base_depth=0.05, plates=8, plate_h=0.16, rim=(0.90, 0.99, 0.10),
        blade=dict(sweep=1.75, hw=0.15, pw=1.5, qw=0.9, lead=0.9, gam=1.2, r1=0.93),
        crown=dict(sweep=2.0, hw=0.11, pw=1.4, qw=0.95, lead=0.9, gam=1.25, r1=0.95),
        colors=C('#6a55e8', '#0e0b26', '#a79bff', '#231a4f')),
    'nightveil': dict(  # Stealth Spinner: three broad veil wings
        n=3, base_n=3, base_depth=0.05, plates=6, plate_h=0.15,
        blade=dict(sweep=1.3, hw=0.33, pw=1.3, qw=0.9, lead=0.85, gam=1.1),
        crown=dict(sweep=1.55, hw=0.26, pw=1.25, qw=0.9, lead=0.85, notch=0.04, nz=3, gam=1.1),
        colors=C('#8d2fd6', '#160b30', '#d27bff', '#1f1442')),
    'spectra': dict(  # Illusion Spinner: five faceted prism shards
        kind='armor', n=5, base_n=10, base_depth=0.07, plates=10, plate_h=0.16,
        blade=dict(hw0=0.24, hw1=0.30, cut=0.26, skew=0.34, tipw=0.1),
        crown=dict(hw0=0.18, hw1=0.22, cut=0.20, skew=0.30, tipw=0.1, r1=0.96),
        colors=C('#ff5cc8', '#3a1a66', '#ffa6e8', '#2a1650')),
    'ghost-viper': dict(  # Dodge / Counter Spinner: three S-curved fangs
        n=3, base_n=6, base_depth=0.10, plates=6, plate_h=0.16,
        blade=dict(sweep=1.6, hw=0.22, pw=1.6, hook=0.9, wave=0.05, wave_n=1, lead=0.85, gam=1.1),
        crown=dict(sweep=1.95, hw=0.13, pw=1.5, hook=1.1, lead=0.9, gam=1.1),
        colors=C('#1fbf5a', '#0b1a14', '#7bff9b', '#1c1a45')),
    'chrono': dict(  # Time Controller: a gear rim round short plates
        kind='armor', n=6, base_n=18, base_depth=0.05, base_r=0.98, plates=12, plate_h=0.17, rim=(0.86, 0.99, 0.12),
        blade=dict(hw0=0.20, hw1=0.27, cut=0.08, skew=0.12, tipw=0.7, r1=0.86),
        crown=dict(hw0=0.14, hw1=0.19, cut=0.06, skew=0.10, tipw=0.7, r1=0.82),
        colors=C('#e2ba3a', '#1a1030', '#ffe27a', '#2a1a52')),
    'nebula-drift': dict(  # Endurance Specialist: four long spiral arms in a rim
        n=4, base_n=4, base_depth=0.05, plates=8, plate_h=0.15, rim=(0.92, 0.99, 0.09),
        blade=dict(sweep=2.3, hw=0.16, pw=1.4, qw=0.9, lead=0.9, gam=1.5, r1=0.94),
        crown=dict(sweep=2.7, hw=0.12, pw=1.4, qw=0.95, lead=0.9, gam=1.5, r1=0.95),
        colors=C('#3a62e0', '#0c1034', '#9fb8ff', '#1e1948')),
}

DESIGNS = {**ATTACK, **DEFENSE, **STAMINA}
