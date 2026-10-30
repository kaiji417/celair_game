# 新ロゴ（CGT_logo_横_黄色.png / CGT_logo_縦_黄色.png）を frontend/public に取り込む。
# 余白を切り詰め、白地なら透過にし、表示用に縮小する。
# 使い方: powershell -File tools/import-logo.ps1 <横ロゴ> <縦ロゴ>
param([string]$Horizontal, [string]$Stacked)
Add-Type -AssemblyName System.Drawing
$outDir = Join-Path $PSScriptRoot '..\frontend\public'

function Import-Logo([string]$src, [string]$dest, [int]$maxW) {
  $bmp = [System.Drawing.Bitmap]::FromFile((Resolve-Path $src))
  $w = $bmp.Width; $h = $bmp.Height
  $rect = New-Object System.Drawing.Rectangle 0, 0, $w, $h
  $d = $bmp.LockBits($rect, 'ReadOnly', 'Format32bppArgb')
  $stride = $d.Stride
  $buf = New-Object byte[] ($stride * $h)
  [Runtime.InteropServices.Marshal]::Copy($d.Scan0, $buf, 0, $buf.Length)
  $bmp.UnlockBits($d); $bmp.Dispose()

  # 透過PNGか白地かを判定（四隅のアルファで見る）
  $transparent = $buf[3] -lt 250
  # 1画素ごとの不透明度: 透過PNGはそのまま、白地は「白からの離れ具合」
  $minX = $w; $minY = $h; $maxX = -1; $maxY = -1
  for ($y = 0; $y -lt $h; $y++) {
    $row = $y * $stride
    for ($x = 0; $x -lt $w; $x++) {
      $i = $row + $x * 4
      if ($transparent) { $a = $buf[$i + 3] }
      else { $a = 255 - [Math]::Min($buf[$i], [Math]::Min($buf[$i + 1], $buf[$i + 2])) }
      if ($a -gt 24) {
        if ($x -lt $minX) { $minX = $x }; if ($x -gt $maxX) { $maxX = $x }
        if ($y -lt $minY) { $minY = $y }; if ($y -gt $maxY) { $maxY = $y }
      }
    }
  }
  $pad = 12
  $cx = [Math]::Max(0, $minX - $pad); $cy = [Math]::Max(0, $minY - $pad)
  $cw = [Math]::Min($w - $cx, $maxX - $minX + 1 + $pad * 2)
  $ch = [Math]::Min($h - $cy, $maxY - $minY + 1 + $pad * 2)

  # 切り出し。白地の場合は色をロゴ色(#D5B345)に固定し、濃淡をアルファに乗せる
  $crop = New-Object System.Drawing.Bitmap $cw, $ch, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $od = $crop.LockBits((New-Object System.Drawing.Rectangle 0, 0, $cw, $ch), 'WriteOnly', 'Format32bppArgb')
  $ob = New-Object byte[] ($od.Stride * $ch)
  for ($y = 0; $y -lt $ch; $y++) {
    for ($x = 0; $x -lt $cw; $x++) {
      $si = ($cy + $y) * $stride + ($cx + $x) * 4
      $di = $y * $od.Stride + $x * 4
      if ($transparent) {
        $ob[$di] = $buf[$si]; $ob[$di + 1] = $buf[$si + 1]; $ob[$di + 2] = $buf[$si + 2]; $ob[$di + 3] = $buf[$si + 3]
      } else {
        $a = 255 - [Math]::Min($buf[$si], [Math]::Min($buf[$si + 1], $buf[$si + 2]))
        # 白からの離れ具合をロゴ色の最大値（青 0x45 側）で正規化
        $a = [Math]::Min(255, [int]($a * 255 / (255 - 0x45)))
        $ob[$di] = 0x45; $ob[$di + 1] = 0xB3; $ob[$di + 2] = 0xD5; $ob[$di + 3] = $a
      }
    }
  }
  [Runtime.InteropServices.Marshal]::Copy($ob, 0, $od.Scan0, $ob.Length)
  $crop.UnlockBits($od)

  # 表示用に縮小（原寸 4571px は重い）
  $scale = [Math]::Min(1.0, $maxW / $cw)
  $nw = [int]($cw * $scale); $nh = [int]($ch * $scale)
  $out = New-Object System.Drawing.Bitmap $nw, $nh, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($out)
  $g.InterpolationMode = 'HighQualityBicubic'; $g.PixelOffsetMode = 'HighQuality'; $g.CompositingMode = 'SourceCopy'
  $g.DrawImage($crop, 0, 0, $nw, $nh)
  $g.Dispose(); $crop.Dispose()
  $path = Join-Path $outDir $dest
  $out.Save($path, [System.Drawing.Imaging.ImageFormat]::Png); $out.Dispose()
  Write-Host ("{0}: transparent={1} crop={2}x{3} -> {4}x{5}" -f $dest, $transparent, $cw, $ch, $nw, $nh)
}

Import-Logo $Horizontal 'logo-horizontal.png' 1400
Import-Logo $Stacked 'logo-stacked.png' 900
