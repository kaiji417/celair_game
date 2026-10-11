# ロゴ原画（白背景・黒字）から2バリエーションを切り出して透過PNGにする。
# 白を透明、黒を不透過にするので、任意の背景色に載せられる。
Add-Type -AssemblyName System.Drawing

$src = Join-Path $PSScriptRoot '..\assets\logo-source.jpg'
$outDir = Join-Path $PSScriptRoot '..\frontend\public'
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }

$bmp = [System.Drawing.Bitmap]::FromFile((Resolve-Path $src))
$w = $bmp.Width; $h = $bmp.Height
Write-Host "source: ${w}x${h}"

# ピクセルを一括で取り出す（GetPixelは遅いのでLockBitsを使う）
$rect = New-Object System.Drawing.Rectangle 0, 0, $w, $h
$data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$stride = $data.Stride
$buf = New-Object byte[] ($stride * $h)
[System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $buf, 0, $buf.Length)
$bmp.UnlockBits($data)
$bmp.Dispose()

# 輝度マップ（0-255）と暗ピクセル判定
$THRESH = 150
$colDark = New-Object int[] $w
$rowDark = New-Object int[] $h

for ($y = 0; $y -lt $h; $y++) {
  $row = $y * $stride
  for ($x = 0; $x -lt $w; $x++) {
    $i = $row + $x * 4
    # BGRA順。緑を輝度の近似として使う（グレースケール原画なので十分）
    if ($buf[$i + 1] -lt $THRESH) {
      $colDark[$x]++
      $rowDark[$y]++
    }
  }
}

# 暗ピクセルを含む列を、一定以上の空白で区切ってグループ化する
$GAP = 120
$groups = @()
$start = -1; $lastDark = -1
for ($x = 0; $x -lt $w; $x++) {
  if ($colDark[$x] -gt 0) {
    if ($start -lt 0) { $start = $x }
    $lastDark = $x
  } elseif ($start -ge 0 -and ($x - $lastDark) -gt $GAP) {
    $groups += , @($start, $lastDark)
    $start = -1
  }
}
if ($start -ge 0) { $groups += , @($start, $lastDark) }

Write-Host "found $($groups.Count) group(s)"

# 縦横比で縦組み/横組みを判定して名前を決める
$names = @()
foreach ($g in $groups) {
  $x0 = $g[0]; $x1 = $g[1]
  # このX範囲内での行の上下端を求める
  $y0 = -1; $y1 = -1
  for ($y = 0; $y -lt $h; $y++) {
    $row = $y * $stride
    $hit = $false
    for ($x = $x0; $x -le $x1; $x++) {
      if ($buf[$row + $x * 4 + 1] -lt $THRESH) { $hit = $true; break }
    }
    if ($hit) { if ($y0 -lt 0) { $y0 = $y }; $y1 = $y }
  }
  $gw = $x1 - $x0 + 1; $gh = $y1 - $y0 + 1
  $ratio = $gw / $gh
  $name = if ($ratio -lt 2.2) { 'logo-stacked' } else { 'logo-horizontal' }
  $names += , @($name, $x0, $y0, $gw, $gh)
  Write-Host ("  {0}: x={1} y={2} {3}x{4} ratio={5:N2}" -f $name, $x0, $y0, $gw, $gh, $ratio)
}

# 切り出して透過PNGとして保存
$PAD = 16
foreach ($n in $names) {
  $name = $n[0]; $x0 = $n[1]; $y0 = $n[2]; $gw = $n[3]; $gh = $n[4]

  $cx = [Math]::Max(0, $x0 - $PAD)
  $cy = [Math]::Max(0, $y0 - $PAD)
  $cw = [Math]::Min($w - $cx, $gw + $PAD * 2)
  $ch = [Math]::Min($h - $cy, $gh + $PAD * 2)

  $out = New-Object System.Drawing.Bitmap $cw, $ch, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $od = $out.LockBits(
    (New-Object System.Drawing.Rectangle 0, 0, $cw, $ch),
    [System.Drawing.Imaging.ImageLockMode]::WriteOnly,
    [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $ostride = $od.Stride
  $obuf = New-Object byte[] ($ostride * $ch)

  for ($y = 0; $y -lt $ch; $y++) {
    $srow = ($cy + $y) * $stride
    $drow = $y * $ostride
    for ($x = 0; $x -lt $cw; $x++) {
      $lum = $buf[$srow + ($cx + $x) * 4 + 1]
      # 白(255)→透明, 黒(0)→不透過。擦れの濃淡がアルファに乗る
      $alpha = 255 - $lum
      $di = $drow + $x * 4
      $obuf[$di]     = 0        # B
      $obuf[$di + 1] = 0        # G
      $obuf[$di + 2] = 0        # R
      $obuf[$di + 3] = $alpha   # A
    }
  }

  [System.Runtime.InteropServices.Marshal]::Copy($obuf, 0, $od.Scan0, $obuf.Length)
  $out.UnlockBits($od)

  $path = Join-Path $outDir "$name.png"
  $out.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $out.Dispose()
  Write-Host "  -> $name.png (${cw}x${ch})"
}

Write-Host 'done'
