import type { ClassEntity } from "@/contracts/class.contract";

type ClassTableProps = {
  classes: ClassEntity[];
  selectedClassId: string;
  onSelect: (classId: string) => void;
};

export function ClassTable({
  classes,
  selectedClassId,
  onSelect,
}: ClassTableProps) {
  return (
    <table className="w-full border-collapse text-[12.5px] tabular-nums">
      <thead>
        <tr>
          <th className="border-b-[2.5px] border-[#161616] px-2.5 py-2 text-left text-[10px] font-black tracking-[1.5px] text-[#6A6A68]">
            반
          </th>
          <th className="border-b-[2.5px] border-[#161616] px-2.5 py-2 text-left text-[10px] font-black tracking-[1.5px] text-[#6A6A68]">
            학년
          </th>
        </tr>
      </thead>
      <tbody>
        {classes.map((cls) => {
          const selected = cls.id === selectedClassId;
          return (
            <tr
              key={cls.id}
              className={selected ? "bg-white" : "hover:bg-white"}
            >
              <td className="border-b border-[#C2C2C0] px-2.5 py-2">
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onSelect(cls.id)}
                  className="min-h-11 text-left text-[15px] font-black tracking-[-0.3px]"
                >
                  {cls.name}
                </button>
              </td>
              <td className="border-b border-[#C2C2C0] px-2.5 py-2 text-[#6A6A68]">
                {cls.grade}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
