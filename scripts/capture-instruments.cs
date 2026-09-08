// Run through the official Unity CLI eval_file command; temporary Editor preview only.
var outDir = System.IO.Path.GetFullPath(System.IO.Path.Combine(UnityEngine.Application.dataPath, "../Playables/beat-bloom/assets/source"));
System.IO.Directory.CreateDirectory(outDir);
var results = new System.Collections.Generic.List<object>();
foreach (var name in new [] { "Piano", "Trumpet" }) {
    var prefabPath = "Assets/_Ludaxis/BeatBloom/Art/Instrument/prefab/musicItem_" + name + ".prefab";
    var prefab = UnityEditor.AssetDatabase.LoadAssetAtPath<UnityEngine.GameObject>(prefabPath);
    var root = UnityEngine.Object.Instantiate(prefab);
    root.hideFlags = UnityEngine.HideFlags.HideAndDontSave;
    var preview = new UnityEditor.PreviewRenderUtility();
    try {
        preview.AddSingleGO(root);
        root.transform.position = UnityEngine.Vector3.zero;
        foreach (var anim in root.GetComponentsInChildren<Spine.Unity.SkeletonAnimation>(true)) {
            anim.Initialize(true);
            anim.Skeleton.SetToSetupPose();
            anim.Update(0f);
            anim.LateUpdate();
        }
        var renderers = root.GetComponentsInChildren<UnityEngine.Renderer>(true).Where(r => r.enabled).ToArray();
        var bounds = renderers[0].bounds;
        foreach(var r in renderers) bounds.Encapsulate(r.bounds);
        var camera = preview.camera;
        camera.orthographic = true;
        camera.orthographicSize = System.Math.Max(bounds.extents.x, bounds.extents.y) * 1.1f;
        camera.transform.position = bounds.center + new UnityEngine.Vector3(0, 0, -10);
        camera.transform.rotation = UnityEngine.Quaternion.identity;
        camera.clearFlags = UnityEngine.CameraClearFlags.SolidColor;
        camera.backgroundColor = UnityEngine.Color.clear;
        camera.nearClipPlane = 0.01f;
        camera.farClipPlane = 100;
        var mattes = new UnityEngine.Texture2D[2];
        for (var matte = 0; matte < 2; matte++) {
            preview.BeginStaticPreview(new UnityEngine.Rect(0, 0, 256, 256));
            camera.clearFlags = UnityEngine.CameraClearFlags.SolidColor;
            camera.backgroundColor = matte == 0 ? UnityEngine.Color.black : UnityEngine.Color.white;
            preview.Render(true);
            mattes[matte] = preview.EndStaticPreview();
        }
        var dark = mattes[0].GetPixels();
        var light = mattes[1].GetPixels();
        var pixels = new UnityEngine.Color[dark.Length];
        for (var i = 0; i < dark.Length; i++) {
            var alpha = UnityEngine.Mathf.Clamp01(1f - (light[i].r - dark[i].r + light[i].g - dark[i].g + light[i].b - dark[i].b) / 3f);
            pixels[i] = alpha < 0.02f ? UnityEngine.Color.clear : new UnityEngine.Color(dark[i].r / alpha, dark[i].g / alpha, dark[i].b / alpha, alpha);
        }
        var texture = new UnityEngine.Texture2D(256, 256, UnityEngine.TextureFormat.RGBA32, false);
        texture.SetPixels(pixels); texture.Apply();
        foreach(var matte in mattes) UnityEngine.Object.DestroyImmediate(matte);
        var output = outDir + "/" + name.ToLowerInvariant() + ".png";
        System.IO.File.WriteAllBytes(output, texture.EncodeToPNG());
        UnityEngine.Object.DestroyImmediate(texture);
        results.Add(new { name, prefabPath, output, renderers = renderers.Length });
    } finally { preview.Cleanup(); }
}
return results;
