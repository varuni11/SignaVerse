"""
Minimal glTF skeleton + forward-kinematics + linear-blend-skinning helpers
for isl-human.glb (a Ready Player Me / Mixamo-named rig).

Used by build_motion.py (to solve bone rotations that reproduce the motion
captured from the reference ISL clips) and by render_check.py (to render the
*actual avatar mesh* in the solved poses so the result can be inspected).
"""
import json, struct
import numpy as np
from scipy.spatial.transform import Rotation as R


class Rig:
    def __init__(self, glb_path):
        buf = open(glb_path, "rb").read()
        jl = struct.unpack("<I", buf[12:16])[0]
        self.j = json.loads(buf[20:20 + jl])
        bin_off = 20 + jl + 8
        self.bin = buf[bin_off:]
        nodes = self.j["nodes"]
        self.n = len(nodes)
        self.names = [x.get("name", f"n{i}") for i, x in enumerate(nodes)]
        self.idx = {nm: i for i, nm in enumerate(self.names)}
        self.parent = [-1] * self.n
        for i, x in enumerate(nodes):
            for c in x.get("children", []):
                self.parent[c] = i
        self.t = np.array([x.get("translation", [0, 0, 0]) for x in nodes], float)
        self.q = [x.get("rotation", [0, 0, 0, 1]) for x in nodes]
        self.rot = [R.from_quat(q) for q in self.q]
        sc = np.array([x.get("scale", [1, 1, 1]) for x in nodes], float)
        assert np.allclose(sc, 1.0, atol=1e-3), "non-unit node scale not supported"
        self.order = self._topo()
        self.bind_pos, self.bind_rot = self.fk({})

    def _topo(self):
        order, seen = [], set()

        def visit(i):
            if i in seen:
                return
            if self.parent[i] >= 0:
                visit(self.parent[i])
            seen.add(i)
            order.append(i)

        for i in range(self.n):
            visit(i)
        return order

    def fk(self, local_override):
        """local_override: {node_name: Rotation(local)}. Returns world pos (n,3), world rot list."""
        pos = np.zeros((self.n, 3))
        rot = [None] * self.n
        for i in self.order:
            lr = local_override.get(self.names[i], self.rot[i])
            p = self.parent[i]
            if p < 0:
                pos[i] = self.t[i]
                rot[i] = lr
            else:
                pos[i] = pos[p] + rot[p].apply(self.t[i])
                rot[i] = rot[p] * lr
        return pos, rot

    # ---- mesh + skinning (for visual verification only) ----
    def _accessor(self, ai):
        a = self.j["accessors"][ai]
        bv = self.j["bufferViews"][a["bufferView"]]
        off = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
        ncomp = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}[a["type"]]
        dt = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16,
              5125: np.uint32, 5126: np.float32}[a["componentType"]]
        stride = bv.get("byteStride")
        cnt = a["count"]
        if stride and stride != ncomp * np.dtype(dt).itemsize:
            raw = np.frombuffer(self.bin, dtype=np.uint8, count=stride * cnt, offset=off)
            raw = raw.reshape(cnt, stride)[:, : ncomp * np.dtype(dt).itemsize].copy()
            arr = raw.view(dt).reshape(cnt, ncomp)
        else:
            arr = np.frombuffer(self.bin, dtype=dt, count=cnt * ncomp, offset=off).reshape(cnt, ncomp)
        if a.get("normalized"):
            arr = arr.astype(np.float32) / np.iinfo(dt).max
        return arr

    def load_meshes(self, skip=("EyeLeft", "EyeRight", "Wolf3D_Teeth")):
        skin = self.j["skins"][0]
        self.joint_nodes = skin["joints"]
        self.ibm = self._accessor(skin["inverseBindMatrices"]).reshape(-1, 4, 4).transpose(0, 2, 1)
        meshes = []
        for ni, nd in enumerate(self.j["nodes"]):
            if "mesh" not in nd:
                continue
            m = self.j["meshes"][nd["mesh"]]
            if m.get("name") in skip:
                continue
            for pr in m["primitives"]:
                at = pr["attributes"]
                if "JOINTS_0" not in at:
                    continue
                meshes.append(dict(
                    name=m.get("name"),
                    pos=self._accessor(at["POSITION"]).astype(float),
                    joints=self._accessor(at["JOINTS_0"]).astype(int),
                    weights=self._accessor(at["WEIGHTS_0"]).astype(float),
                    idx=self._accessor(pr["indices"]).reshape(-1, 3).astype(int),
                ))
        return meshes

    def skin_matrices(self, local_override):
        pos, rot = self.fk(local_override)
        mats = np.zeros((len(self.joint_nodes), 4, 4))
        for k, ni in enumerate(self.joint_nodes):
            M = np.eye(4)
            M[:3, :3] = rot[ni].as_matrix()
            M[:3, 3] = pos[ni]
            mats[k] = M @ self.ibm[k]
        return mats

    def skinned(self, mesh, mats):
        p = np.c_[mesh["pos"], np.ones(len(mesh["pos"]))]
        out = np.zeros((len(p), 3))
        for k in range(4):
            w = mesh["weights"][:, k:k + 1]
            M = mats[mesh["joints"][:, k]]
            out += w * np.einsum("nij,nj->ni", M, p)[:, :3]
        return out
