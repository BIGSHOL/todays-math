import type { StudentEntity } from "@/contracts/class.contract";

type StudentListProps = {
  students: StudentEntity[];
};

export function StudentList({ students }: StudentListProps) {
  return (
    <section>
      <h2 className="mb-2 border-t-[3px] border-[#161616] pt-1.5 text-[10.5px] font-black tracking-[2.5px]">
        학생
      </h2>
      <ul aria-label="학생" className="flex flex-col">
        {students.map((student) => (
          <li
            key={student.id}
            className="border-b border-[#C2C2C0] py-2.5 text-[12.5px] font-bold"
          >
            {student.name}
          </li>
        ))}
      </ul>
    </section>
  );
}
