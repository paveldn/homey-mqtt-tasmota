import os

files = os.listdir()
files.sort()
outFile = open("result.json","w+")
for f in files:
    if os.path.isfile(f) and f.endswith('.svg'):
        outFile.write("{\n");
        outFile.write("\t\"id\": \"" + f + "\",\n");
        outFile.write("\t\"label\": {\n");
        outFile.write("\t\t\"en\": \"" + f[:-4].replace("_", " ").capitalize() + "\"\n");
        outFile.write("\t}\n");
        outFile.write("},\n");
        print(f)
outFile.close();
