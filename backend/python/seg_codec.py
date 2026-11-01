#!/usr/bin/env python3
"""Private subprocess codec: JSON + exact source DICOMs <-> standard binary DICOM SEG.

The Java service owns authentication, permissions, revisions and durable storage.
This helper never connects to a network and never receives credentials.
"""
import json
import sys
from pathlib import Path

import highdicom as hd
import numpy as np
import pydicom
from highdicom.sr.coding import CodedConcept
from pydicom.uid import CTImageStorage, SegmentationStorage, generate_uid, ExplicitVRLittleEndian

LABELMAP_STORAGE = '1.2.840.10008.5.1.4.1.1.66.7'

MAX_VOXELS = 134_217_728


class ValidationError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise ValidationError(message)


def runs_to_mask(runs, rows, columns):
    require(len(runs) % 2 == 0, '掩码游程必须是起点和长度的成对列表')
    mask = np.zeros(rows * columns, dtype=np.uint8)
    end = 0
    for start, length in zip(runs[::2], runs[1::2]):
        require(isinstance(start, int) and isinstance(length, int)
                and not isinstance(start, bool) and not isinstance(length, bool), '掩码坐标必须是整数')
        require(start >= end and length > 0 and start + length <= mask.size, '掩码游程越界或重叠')
        mask[start:start + length] = 1
        end = start + length
    return mask.reshape(rows, columns)


def mask_to_runs(mask):
    data = np.asarray(mask, dtype=np.uint8).reshape(-1)
    changes = np.flatnonzero(np.diff(np.r_[0, data != 0, 0].astype(np.int8)))
    runs = []
    for start, end in changes.reshape(-1, 2):
        runs.extend((int(start), int(end - start)))
    return runs


def validate_sources(source_entries, load_files):
    require(0 < len(source_entries) <= 2048, '一个分割仅支持 1 至 2048 张 CT 切片')
    ids = [s['id'] for s in source_entries]
    require(len(ids) == len(set(ids)), '源影像清单存在重复切片')
    if not load_files:
        sop_uids = [s['sopInstanceUid'] for s in source_entries]
        require(len(sop_uids) == len(set(sop_uids)), '源影像 SOP 编号重复')
        return None
    sources = [pydicom.dcmread(s['path'], stop_before_pixels=True) for s in source_entries]
    reference = sources[0]
    required = ('Rows', 'Columns', 'ImagePositionPatient', 'ImageOrientationPatient', 'PixelSpacing',
                'FrameOfReferenceUID', 'StudyInstanceUID', 'SeriesInstanceUID', 'SOPInstanceUID')
    for ds in sources:
        require(all(hasattr(ds, attr) for attr in required), 'CT 缺少分割所需的空间坐标或影像编号')
        require(ds.SOPClassUID == CTImageStorage and int(getattr(ds, 'NumberOfFrames', 1)) == 1,
                '当前绘制器仅支持单帧 CT DICOM 序列')
        require(int(ds.Rows) == int(reference.Rows) and int(ds.Columns) == int(reference.Columns), '同一分割中的 CT 尺寸不一致')
        require(str(ds.SeriesInstanceUID) == str(reference.SeriesInstanceUID)
                and str(ds.StudyInstanceUID) == str(reference.StudyInstanceUID)
                and str(ds.FrameOfReferenceUID) == str(reference.FrameOfReferenceUID), '一个分割必须对应同一序列及坐标系')
        require(np.allclose(ds.ImageOrientationPatient, reference.ImageOrientationPatient, rtol=0, atol=1e-5)
                and np.allclose(ds.PixelSpacing, reference.PixelSpacing, rtol=0, atol=1e-5), 'CT 方向或像素间距不一致，无法直接叠加分割')
        require(len(ds.ImagePositionPatient) == 3 and np.isfinite(ds.ImagePositionPatient).all(), 'CT 空间位置无效')
        require(len(ds.ImageOrientationPatient) == 6 and np.isfinite(ds.ImageOrientationPatient).all()
                and len(ds.PixelSpacing) == 2 and (np.asarray(ds.PixelSpacing) > 0).all(), 'CT 方向或像素间距无效')
        # Some old CTs omit type-2 patient/study attributes. Empty values satisfy DICOM requirements.
        for attr in ('PatientName', 'PatientID', 'PatientBirthDate', 'PatientSex', 'AccessionNumber',
                     'StudyDate', 'StudyTime', 'StudyID', 'ReferringPhysicianName'):
            if not hasattr(ds, attr): setattr(ds, attr, '')
    rows, columns = int(reference.Rows), int(reference.Columns)
    require(rows > 0 and columns > 0 and rows * columns * len(sources) <= MAX_VOXELS,
            '该序列超过当前演示绘制器的体素上限')
    uids = [str(ds.SOPInstanceUID) for ds in sources]
    require(len(uids) == len(set(uids)), '源影像 SOP 编号重复')
    positions = [tuple(float(v) for v in ds.ImagePositionPatient) for ds in sources]
    require(len(positions) == len(set(positions)), '同一序列中存在重复空间位置，暂不支持该扫描')
    return sources


def encode(manifest, output):
    entries = manifest['sources']
    sources = validate_sources(entries, True)
    rows, columns = int(sources[0].Rows), int(sources[0].Columns)
    by_id = {entry['id']: index for index, entry in enumerate(entries)}
    pixels = np.zeros((len(sources), rows, columns), dtype=np.uint8)
    descriptions = manifest.get('segments', [{'number': 1, 'label': manifest.get('label', '手绘区域'), 'color': [255, 80, 80]}])
    numbers = {s['number'] for s in descriptions}
    require(0 < len(descriptions) <= 64 and len(numbers) == len(descriptions)
            and all(isinstance(n, int) and 0 < n <= 255 for n in numbers), '标签编号或数量无效（最多 64 个标签，编号 1 至 255）')
    seen = set()
    for mask in manifest['masks']:
        instance_id = mask['instanceId']
        require(instance_id in by_id and instance_id not in seen, '掩码包含未授权或重复的源切片')
        seen.add(instance_id)
        if 'segments' not in manifest:
            pixels[by_id[instance_id]] = runs_to_mask(mask['runs'], rows, columns)
        else:
            runs = mask['runs']
            require(len(runs) % 3 == 0, 'Labelmap 游程格式无效')
            flat = pixels[by_id[instance_id]].reshape(-1)
            end = 0
            for start, length, number in zip(runs[::3], runs[1::3], runs[2::3]):
                require(start >= end and length > 0 and start + length <= flat.size and number in numbers, 'Labelmap 像素越界、重叠或标签不存在')
                flat[start:start + length] = number
                end = start + length
    has_pixels = bool(pixels.any())
    label = str(manifest.get('label', '手绘区域')).strip()
    require(0 < len(label) <= 64, '分割名称必须为 1 至 64 个字符')
    segment_descriptions = []
    for item in sorted(descriptions, key=lambda s: s['number']):
        require(0 < len(item['label'].strip()) <= 64, '标签名称必须为 1 至 64 个字符')
        description = hd.seg.SegmentDescription(
        segment_number=item['number'],
        segment_label=item['label'],
        segmented_property_category=CodedConcept('85756007', 'SCT', 'Tissue'),
        segmented_property_type=CodedConcept('91723000', 'SCT', 'Anatomical structure'),
        algorithm_type=hd.seg.SegmentAlgorithmTypeValues.MANUAL,
        )
        # Preserve display colors in the standard CIELab attribute.
        from highdicom.color import CIELabColor
        rgb = item.get('color', [255, 80, 80])
        require(len(rgb) == 3 and all(isinstance(c, int) and 0 <= c <= 255 for c in rgb), '标签颜色无效')
        description.RecommendedDisplayCIELabValue = list(CIELabColor.from_rgb(*rgb).value)
        segment_descriptions.append(description)
    seg = hd.seg.Segmentation(
        source_images=sources,
        pixel_array=pixels,
        segmentation_type=hd.seg.SegmentationTypeValues.LABELMAP,
        segment_descriptions=segment_descriptions,
        transfer_syntax_uid=ExplicitVRLittleEndian,
        series_instance_uid=generate_uid(),
        series_number=900,
        sop_instance_uid=generate_uid(),
        instance_number=1,
        manufacturer='Medical Annotation Demo',
        manufacturer_model_name='Minimal Manual Segmentation',
        software_versions='1.0',
        device_serial_number='DEMO',
        content_label='MANUAL_MASK',
        content_description='Manually drawn labelmap segmentation',
        # An explicit all-zero SEG is a valid publication that clears the previous mask.
        omit_empty_frames=has_pixels,
    )
    seg.SpecificCharacterSet = 'ISO_IR 192'
    seg.SeriesDescription = 'Manual segmentation'
    seg.save_as(output, enforce_file_format=True)


def decode(manifest, output, labelmap=False):
    entries = manifest['sources']
    validate_sources(entries, False)
    ds = pydicom.dcmread(manifest['segPath'])
    require((ds.SOPClassUID == SegmentationStorage and ds.SegmentationType == 'BINARY')
            or (ds.SOPClassUID == LABELMAP_STORAGE and ds.SegmentationType == 'LABELMAP'), '文件不是支持的 DICOM SEG')
    descriptions = [s for s in ds.SegmentSequence if int(s.SegmentNumber) != 0]
    require(0 < len(descriptions) <= 64, '分割标签数量无效')
    if not labelmap:
        require(len(descriptions) == 1 and int(descriptions[0].SegmentNumber) == 1,
                '此分割有多个标签，请使用 OHIF 工作台打开；极简绘制器仅支持单标签')
    expected = {entry['sopInstanceUid'] for entry in entries}
    referenced = set()
    for series in ds.get('ReferencedSeriesSequence', []):
        referenced.update(str(instance.ReferencedSOPInstanceUID) for instance in series.ReferencedInstanceSequence)
    for frame in ds.PerFrameFunctionalGroupsSequence:
        for derivation in frame.get('DerivationImageSequence', []):
            referenced.update(str(image.ReferencedSOPInstanceUID) for image in derivation.get('SourceImageSequence', []))
    require(referenced and referenced.issubset(expected), '分割引用了当前影像集以外的 CT 切片')
    rows, columns = int(entries[0]['rows']), int(entries[0]['columns'])
    require(int(ds.Rows) == rows and int(ds.Columns) == columns, '分割尺寸与源 CT 不一致')
    seg = hd.seg.Segmentation.from_dataset(ds)
    pixels = seg.get_pixels_by_source_instance(
        source_sop_instance_uids=[entry['sopInstanceUid'] for entry in entries],
        segment_numbers=[int(s.SegmentNumber) for s in descriptions],
        assert_missing_frames_are_empty=True,
    )
    masks = []
    segments = []
    if labelmap:
        from highdicom.color import CIELabColor
        for description in descriptions:
            color = [255, 80, 80]
            if hasattr(description, 'RecommendedDisplayCIELabValue'):
                color = [int(round(v)) for v in CIELabColor.from_dicom_value(description.RecommendedDisplayCIELabValue).to_rgb()]
            segments.append({'number': int(description.SegmentNumber), 'label': str(description.SegmentLabel), 'color': color})
    for index, entry in enumerate(entries):
        if labelmap:
            flat = np.zeros(rows * columns, dtype=np.uint8)
            for j, segment in enumerate(segments):
                nonzero = pixels[index, :, :, j].reshape(-1) != 0
                require(not np.any(flat[nonzero]), '重叠二值分割无法转换为 Labelmap')
                flat[nonzero] = segment['number']
            changes = np.flatnonzero(np.diff(np.r_[-1, flat.astype(np.int32), -1]))
            runs = []
            for start, end in zip(changes[:-1], changes[1:]):
                if flat[start]: runs.extend((int(start), int(end - start), int(flat[start])))
        else:
            runs = mask_to_runs(pixels[index, :, :, 0])
        if runs: masks.append({'instanceId': entry['id'], 'runs': runs})
    result = {'segments': segments, 'masks': masks} if labelmap else masks
    Path(output).write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')


def main():
    require(len(sys.argv) == 4 and sys.argv[1] in ('encode', 'decode', 'decode-labelmap'), '编解码参数无效')
    action, input_path, output = sys.argv[1:]
    manifest = json.loads(Path(input_path).read_text(encoding='utf-8'))
    if action == 'encode': encode(manifest, output)
    else: decode(manifest, output, action == 'decode-labelmap')


if __name__ == '__main__':
    try:
        main()
    except ValidationError as error:
        # Only controlled validation messages are returned, never raw patient metadata or paths.
        print(json.dumps({'error': str(error)}, ensure_ascii=False))
        sys.exit(2)
    except Exception as error:
        print(json.dumps({'error': 'DICOM SEG 编解码失败，请检查源 CT 的空间信息',
                          'exceptionType': type(error).__name__}, ensure_ascii=False))
        sys.exit(3)
