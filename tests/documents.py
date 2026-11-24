"""Create synthetic inputs and reopen downloads using independent readers."""
import io
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZipFile

import xlsxwriter
from docx import Document
from docx.opc.constants import RELATIONSHIP_TYPE
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from openpyxl import load_workbook
from openpyxl.cell.rich_text import TextBlock
from PIL import Image
from pptx import Presentation
from pptx.util import Inches
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen.canvas import Canvas

MARKER = "ALIFBO_LOCAL_ONLY_4923"
FONT = Path(__file__).resolve().parents[1] / "public/fonts/NotoSans-Regular.ttf"
SPREADSHEET = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"


def generate(directory):
    directory.mkdir(parents=True, exist_ok=True)
    image = directory / "fixture.png"
    Image.new("RGB", (24, 24), "#328060").save(image)

    document = Document()
    paragraph = document.add_paragraph()
    paragraph.add_run("S").bold = True
    paragraph.add_run("hahar")
    document.add_table(1, 1).cell(0, 0).text = "Chiroq"
    document.sections[0].header.paragraphs[0].text = "O‘ZBEKISTON"
    document.sections[0].footer.paragraphs[0].text = "Gʼuzor"
    document.add_picture(image.as_posix())
    link_paragraph = document.add_paragraph()
    link = OxmlElement("w:hyperlink")
    link.set(qn("r:id"), link_paragraph.part.relate_to(
        "https://example.com/unchanged", RELATIONSHIP_TYPE.HYPERLINK, is_external=True
    ))
    run = OxmlElement("w:r")
    text = OxmlElement("w:t")
    text.text = "Shahar"
    run.append(text)
    link.append(run)
    link_paragraph._p.append(link)
    separated = document.add_paragraph()
    separated.add_run("S").add_tab()
    separated.add_run("h")
    document.add_paragraph(MARKER)
    document.save(directory / "hisobot.docx")

    xlsx_buffer = io.BytesIO()
    with xlsxwriter.Workbook(xlsx_buffer, {"in_memory": True}) as workbook:
        sheet = workbook.add_worksheet("Shahar")
        bold = workbook.add_format({"bold": True})
        date_format = workbook.add_format({"num_format": "yyyy-mm-dd"})
        sheet.write_string("A1", "Shahar")
        sheet.write_rich_string("A2", bold, "C", "hiroq")
        sheet.write_formula("A3", '=IF(2+3=5,"Shahar","Chiroq")', None, "Shahar")
        sheet.write_number("A4", 2026)
        sheet.write_datetime("A5", datetime(2026, 11, 24), date_format)
        sheet.write_string("A6", MARKER)
        sheet.write_string("A7", "overwrite with inline string")
        sheet.write_string("A8", "overwrite with rich inline string")
        sheet.write_formula("A9", '=IF(1=1,"Shahar","")', None, "Shahar")
        sheet.write_string("A10", "overwrite with the string value type")

    # Include both inline encodings and a formula cache referring to a shared string.
    ET.register_namespace("", SPREADSHEET)
    ns = {"s": SPREADSHEET}
    with ZipFile(xlsx_buffer) as original, ZipFile(directory / "jadval.xlsx", "w") as result:
        for entry in original.infolist():
            payload = original.read(entry)
            if entry.filename == "xl/worksheets/sheet1.xml":
                xml = ET.fromstring(payload)
                for address, text in [
                    ("A7", "<is><t>Gʻuzor</t></is>"),
                    ("A8", "<is><r><rPr><b/></rPr><t>S</t></r><r><t>_x0068_ahar</t></r></is>"),
                ]:
                    cell = xml.find(f".//s:c[@r='{address}']", ns)
                    cell.set("t", "inlineStr")
                    cell.remove(cell.find("s:v", ns))
                    cell.append(ET.fromstring(text.replace("<is>", f'<is xmlns="{SPREADSHEET}">')))
                formula = xml.find(".//s:c[@r='A9']", ns)
                formula.set("t", "s")
                formula.find("s:v", ns).text = "0"
                literal = xml.find(".//s:c[@r='A10']", ns)
                literal.set("t", "str")
                literal.find("s:v", ns).text = "Chiroq"
                payload = ET.tostring(xml, encoding="utf-8", xml_declaration=True)
            result.writestr(entry, payload)

    presentation = Presentation()
    slide = presentation.slides.add_slide(presentation.slide_layouts[5])
    slide.shapes.title.text = "Ўзбекистон"
    textbox = slide.shapes.add_textbox(Inches(1), Inches(2), Inches(5), Inches(1))
    p = textbox.text_frame.paragraphs[0]
    run = p.add_run()
    run.text = "Ю"
    run.font.bold = True
    run = p.add_run()
    run.text = "Л, Шаҳар"
    run.hyperlink.address = "https://example.com/unchanged"
    table = slide.shapes.add_table(1, 1, Inches(1), Inches(3), Inches(5), Inches(1)).table
    table.cell(0, 0).text = "Чироқ, Ғузор. " + MARKER
    slide.shapes.add_picture(image.as_posix(), Inches(1), Inches(5))
    presentation.save(directory / "taqdimot.pptx")

    pdfmetrics.registerFont(TTFont("NotoSans", FONT.as_posix()))
    pdf = Canvas((directory / "matn.pdf").as_posix())
    pdf.setFont("NotoSans", 14)
    pdf.drawString(60, 730, "ÖZBEKISTON, Ğuzor, Şahar, ÇIROQ.")
    pdf.setFont("Helvetica", 14)
    pdf.drawString(60, 700, MARKER)
    pdf.showPage()
    pdf.drawImage(image.as_posix(), 60, 700, 54, 54)
    pdf.showPage()
    pdf.setFont("NotoSans", 14)
    pdf.drawString(60, 730, "ŞARQ")
    pdf.save()

    pdf = Canvas((directory / "scan.pdf").as_posix())
    pdf.drawImage(image.as_posix(), 60, 700, 54, 54)
    pdf.save()


def check_package(source, target, allowed_changes):
    with ZipFile(source) as original, ZipFile(target) as result:
        assert set(original.namelist()) == set(result.namelist())
        assert result.testzip() is None
        for name in original.namelist():
            if name not in allowed_changes:
                assert original.read(name) == result.read(name), name


def verify(directory, output, layout=None):
    docx = Document(output / "hisobot-alifbo.docx")
    paragraph = docx.paragraphs[0]
    assert paragraph.text == "Şahar"
    assert paragraph.runs[0].text == "Ş" and paragraph.runs[0].bold is True
    assert paragraph.runs[1].text == "ahar" and paragraph.runs[1].bold is not True
    assert docx.tables[0].cell(0, 0).text == "Çiroq"
    assert docx.sections[0].header.paragraphs[0].text == "ÖZBEKISTON"
    assert docx.sections[0].footer.paragraphs[0].text == "Ğuzor"
    assert len(docx.inline_shapes) == 1
    assert docx.paragraphs[2].hyperlinks[0].text == "Şahar"
    assert docx.paragraphs[2].hyperlinks[0].url == "https://example.com/unchanged"
    assert docx.paragraphs[3].text == "S\th"
    check_package(directory / "hisobot.docx", output / "hisobot-alifbo.docx",
                  {"word/document.xml", "word/header1.xml", "word/footer1.xml"})

    xlsx = output / "jadval-alifbo.xlsx"
    book = load_workbook(xlsx, rich_text=True)
    assert book.sheetnames == ["Shahar"]
    sheet = book.active
    assert sheet["A1"].value == "Şahar"
    assert str(sheet["A2"].value) == "Çiroq"
    assert str(sheet["A7"].value) == "Ğuzor"
    assert str(sheet["A8"].value) == "Şahar"
    for address, first in [("A2", "Ç"), ("A8", "Ş")]:
        formatted = sheet[address].value[0]
        assert isinstance(formatted, TextBlock) and formatted.text == first and formatted.font.b
    assert sheet["A3"].value == '=IF(2+3=5,"Shahar","Chiroq")'
    assert sheet["A4"].value == 2026 and sheet["A5"].value == datetime(2026, 11, 24)
    assert sheet["A9"].value == '=IF(1=1,"Shahar","")'
    assert sheet["A10"].value == "Çiroq"
    with ZipFile(xlsx) as package:
        ns = {"s": SPREADSHEET}
        xml = ET.fromstring(package.read("xl/worksheets/sheet1.xml"))
        assert xml.find(".//s:c[@r='A3']/s:v", ns).text == "Shahar"
        cache = int(xml.find(".//s:c[@r='A9']/s:v", ns).text)
        shared = ET.fromstring(package.read("xl/sharedStrings.xml"))
        assert shared.findall("s:si", ns)[cache].find("s:t", ns).text == "Shahar"
    check_package(directory / "jadval.xlsx", xlsx, {"xl/sharedStrings.xml", "xl/worksheets/sheet1.xml"})

    pptx = output / "taqdimot-alifbo.pptx"
    slide = Presentation(pptx).slides[0]
    assert slide.shapes.title.text == "Özbekiston"
    text = slide.shapes[1].text_frame.paragraphs[0]
    assert text.text == "YUL, Şahar"
    assert text.runs[0].text == "YU" and text.runs[0].font.bold is True
    assert text.runs[1].hyperlink.address == "https://example.com/unchanged"
    assert slide.shapes[2].table.cell(0, 0).text == "Çiroq, Ğuzor. " + MARKER
    assert slide.shapes[3].image.content_type == "image/png"
    check_package(directory / "taqdimot.pptx", pptx, {"ppt/slides/slide1.xml"})

    pdf = output / "matn-alifbo.pdf"
    text = subprocess.check_output(["pdftotext", pdf, "-"], text=True)
    assert "OʻZBEKISTON, Gʻuzor, Shahar, CHIROQ." in text
    assert MARKER in text and "SHARQ" in text
    fonts = subprocess.check_output(["pdffonts", pdf], text=True)
    assert re.search(r"NotoSans.*?yes\s+yes\s+yes", fonts), fonts
    info = subprocess.check_output(["pdfinfo", pdf], text=True)
    assert re.search(r"^Pages:\s+2$", info, re.M), info

    if layout:
        # A forward conversion verifies all four new letters in the embedded font.
        text = subprocess.check_output(["pdftotext", layout, "-"], text=True)
        assert "ÖZBEKISTON, Ğuzor, Şahar, ÇIROQ." in text


if __name__ == "__main__":
    action, *paths = sys.argv[1:]
    {"generate": generate, "verify": verify}[action](*map(Path, paths))
