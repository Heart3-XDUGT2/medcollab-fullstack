"""Generate tiny, wholly synthetic classic CT slices; never read patient input."""
import argparse
import json
from pathlib import Path

import numpy as np
import pydicom
from pydicom.dataset import FileDataset, FileMetaDataset
from pydicom.uid import CTImageStorage, ExplicitVRLittleEndian, generate_uid


def generate(output: Path):
    output.mkdir(parents=True, exist_ok=True)
    targets = [output / f"synthetic-ct-{index:03d}.dcm" for index in (1, 2)]
    if any(path.exists() for path in [*targets, output / "manifest.json"]):
        raise RuntimeError("Refusing to overwrite an existing synthetic fixture")
    study, series, frame = generate_uid(), generate_uid(), generate_uid()
    instances = []
    for index, target in enumerate(targets, 1):
        sop = generate_uid()
        meta = FileMetaDataset()
        meta.MediaStorageSOPClassUID = CTImageStorage
        meta.MediaStorageSOPInstanceUID = sop
        meta.TransferSyntaxUID = ExplicitVRLittleEndian
        meta.ImplementationClassUID = generate_uid()
        ds = FileDataset(str(target), {}, file_meta=meta, preamble=b"\0" * 128)
        ds.SOPClassUID, ds.SOPInstanceUID = CTImageStorage, sop
        ds.StudyInstanceUID, ds.SeriesInstanceUID, ds.FrameOfReferenceUID = study, series, frame
        ds.PatientName, ds.PatientID = "SYNTHETIC^INTEGRATION", "SYNTHETIC-NOT-A-PATIENT"
        ds.PatientBirthDate, ds.PatientSex = "", "O"
        ds.AccessionNumber, ds.StudyID, ds.ReferringPhysicianName = "INTEGRATION", "1", "Synthetic^Only"
        ds.StudyDate, ds.StudyTime = "20260101", "120000"
        ds.SeriesNumber, ds.InstanceNumber = 1, index
        ds.Modality, ds.Manufacturer = "CT", "MedCollabIntegration"
        ds.StudyDescription, ds.SeriesDescription = "Wholly synthetic integration fixture", "Two synthetic CT slices"
        ds.ImageType = ["ORIGINAL", "PRIMARY", "AXIAL"]
        ds.ImageOrientationPatient, ds.ImagePositionPatient = [1, 0, 0, 0, 1, 0], [0, 0, index - 1]
        ds.PixelSpacing, ds.SliceThickness, ds.SpacingBetweenSlices = [1, 1], 1, 1
        ds.Rows, ds.Columns, ds.SamplesPerPixel = 16, 16, 1
        ds.PhotometricInterpretation = "MONOCHROME2"
        ds.BitsAllocated, ds.BitsStored, ds.HighBit, ds.PixelRepresentation = 16, 16, 15, 1
        ds.RescaleIntercept, ds.RescaleSlope, ds.RescaleType = 0, 1, "HU"
        ds.WindowCenter, ds.WindowWidth = 0, 400
        pixels = np.full((16, 16), -1000, dtype="<i2")
        pixels[4:12, 4:12] = index * 25
        ds.PixelData = pixels.tobytes()
        ds.save_as(target, enforce_file_format=True)
        checked = pydicom.dcmread(target)
        if checked.pixel_array.shape != (16, 16) or checked.SOPClassUID != CTImageStorage:
            raise RuntimeError("Synthetic CT verification failed")
        instances.append({"file": str(target.resolve()), "sopInstanceUID": sop, "instanceNumber": index})
    manifest = {"synthetic": True, "rows": 16, "columns": 16, "totalSlices": 2,
                "studyInstanceUID": study, "seriesInstanceUID": series,
                "frameOfReferenceUID": frame, "instances": instances}
    with (output / "manifest.json").open("x", encoding="utf-8") as handle:
        json.dump(manifest, handle, indent=2)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", required=True, type=Path)
    generate(parser.parse_args().output_dir.resolve())
